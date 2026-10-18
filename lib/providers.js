// Multi-backend Formula 1 data layer.
//
// Every dataset is resolved through a provider chain so the site never depends
// on a single upstream:
//   Sessions / schedule : OpenF1  ->  Jolpica (Ergast)  ->  saved snapshot
//   Standings           : OpenF1  ->  Jolpica           ->  saved snapshot
//   Race timing         : OpenF1  ->  Jolpica           ->  saved snapshot
//   Weekend podium      : OpenF1  ->  Jolpica

const { getDriver, getTeamColour } = require('../data/paddockData');

const OPENF1 = (process.env.OPENF1_API_URL || 'https://api.openf1.org/v1').replace(/\/$/, '');
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const cache = new Map();
// How long the season timetable is trusted. It changes rarely, so ten minutes
// keeps the site well inside the free tier's limits; shorten it (milliseconds)
// if you need a schedule correction to appear sooner.
const SCHEDULE_TTL_MS = (() => {
  const n = Number(process.env.APEX_SCHEDULE_TTL_MS);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 10 * 60 * 1000;
})();

async function fetchJson(url, ttl = 10 * 60 * 1000, timeout = 9000) {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.value;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  const value = await res.json();
  cache.set(url, { value, until: Date.now() + ttl });
  return value;
}

const openF1 = (pathname, ttl) => fetchJson(`${OPENF1}/${pathname}`, ttl);
const jolpica = (pathname, ttl) => fetchJson(`${JOLPICA}/${pathname}`, ttl);

function localClock(iso, offset) {
  if (!iso) return null;
  const [h = '0', m = '0'] = String(offset || '00:00:00').split(':');
  const shifted = new Date(new Date(iso).getTime() + (Number(h) * 60 + Math.sign(Number(h) || 1) * Number(m)) * 60000);
  return shifted.toISOString().replace('Z', `${Number(h) < 0 ? '-' : '+'}${String(Math.abs(Number(h))).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

function mapOpenF1Session(s) {
  const malaysiaRound = s.location === 'Kuala Lumpur' && s.country_name === 'Bahrain';
  return {
    id: s.session_key,
    meetingId: s.meeting_key,
    name: s.session_name,
    type: s.session_type,
    round: s.round_number || null,
    event: malaysiaRound ? 'Bahrain Grand Prix in Malaysia' : s.meeting_name || `${s.location || ''} Grand Prix`,
    country: malaysiaRound ? 'Malaysia' : s.country_name,
    location: s.location,
    circuit: malaysiaRound ? 'Sepang' : s.circuit_short_name,
    circuitKey: s.circuit_key,
    startsAt: s.date_start,
    endsAt: s.date_end,
    offset: s.gmt_offset || '00:00:00',
    localStart: localClock(s.date_start, s.gmt_offset),
    localEnd: localClock(s.date_end, s.gmt_offset),
    cancelled: Boolean(s.is_cancelled)
  };
}

function isGrandPrixRace(s) {
  return s.type === 'Race' && String(s.name || '').trim().toLowerCase() === 'race';
}

async function getOpenF1Sessions() {
  const year = new Date().getUTCFullYear();
  const raw = await openF1(`sessions?year=${year}`, SCHEDULE_TTL_MS);
  return raw
    .filter((s) => !s.is_cancelled && !/^Day\s+\d+$/i.test(s.session_name || '') && s.session_type !== 'Testing')
    .map(mapOpenF1Session)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

async function getJolpicaRaces(year) {
  const data = await jolpica(`${year}/races.json?limit=100`, 30 * 60 * 1000);
  return data?.MRData?.RaceTable?.Races || [];
}

function jolpicaRaceToSession(race) {
  const date = race.date || '';
  const time = race.time || '00:00:00Z';
  const startsAt = `${date}T${time.replace('Z', '')}Z`;
  const endMs = Date.parse(startsAt) + 2 * 60 * 60 * 1000;
  return {
    id: `jolpica-${race.season}-${race.round}`,
    meetingId: `jolpica-${race.season}-${race.round}`,
    name: 'Race',
    type: 'Race',
    round: Number(race.round) || null,
    event: race.raceName || `${race.Circuit?.Location?.locality || ''} Grand Prix`,
    country: race.Circuit?.Location?.country || '',
    location: race.Circuit?.Location?.locality || '',
    circuit: race.Circuit?.circuitName || '',
    circuitKey: null,
    startsAt: Number.isNaN(Date.parse(startsAt)) ? null : startsAt,
    endsAt: Number.isNaN(Date.parse(startsAt)) ? null : new Date(endMs).toISOString(),
    offset: '00:00:00',
    localStart: null,
    localEnd: null,
    cancelled: false
  };
}

// --- Sessions ---------------------------------------------------------------

async function getSessions() {
  const year = new Date().getUTCFullYear();
  const errors = [];
  try {
    const sessions = await getOpenF1Sessions();
    if (sessions.length) return { source: 'OpenF1', provider: 'openf1', sessions };
    errors.push('OpenF1: empty');
  } catch (e) { errors.push(`OpenF1: ${e.message}`); }
  try {
    const races = await getJolpicaRaces(year);
    const sessions = races.map(jolpicaRaceToSession).filter((s) => s.startsAt).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    if (sessions.length) return { source: 'Jolpica', provider: 'jolpica', sessions, errors };
  } catch (e) { errors.push(`Jolpica: ${e.message}`); }
  return { source: 'snapshot', provider: 'none', sessions: [], errors };
}

async function getRaceControl() {
  const { source, sessions } = await getSessions();
  const now = Date.now();
  const usable = sessions.filter((s) => s.startsAt);
  const active = usable.find((s) => Date.parse(s.startsAt) <= now && Date.parse(s.endsAt) >= now) || null;
  const next = usable.find((s) => Date.parse(s.startsAt) > now) || null;
  const latest = usable.filter((s) => Date.parse(s.endsAt) < now).at(-1) || null;
  return {
    source,
    updatedAt: new Date().toISOString(),
    year: new Date().getUTCFullYear(),
    activeSession: active,
    nextSession: next,
    latestSession: latest,
    sessions: usable
  };
}

// --- Standings --------------------------------------------------------------

async function getOpenF1Standings() {
  const sessions = await getOpenF1Sessions();
  const lastRace = sessions.filter((s) => isGrandPrixRace(s) && Date.parse(s.endsAt) < Date.now()).at(-1);
  if (!lastRace) return null;
  const [driverPoints, teamPoints, drivers] = await Promise.all([
    openF1(`championship_drivers?session_key=${lastRace.id}`, 15 * 60 * 1000),
    openF1(`championship_teams?session_key=${lastRace.id}`, 15 * 60 * 1000),
    openF1(`drivers?session_key=${lastRace.id}`, 15 * 60 * 1000)
  ]);
  const byNo = new Map(drivers.map((d) => [d.driver_number, d]));
  const mapped = driverPoints.map((x) => {
    const d = byNo.get(x.driver_number) || {};
    const code = d.name_acronym || String(x.driver_number);
    const fallback = getDriver(code) || getDriver(d.full_name);
    return {
      position: x.position_current,
      name: d.full_name || fallback?.name || `Driver ${x.driver_number}`,
      code,
      team: d.team_name || fallback?.team || '—',
      headshotUrl: d.headshot_url || fallback?.photo || '',
      points: x.points_current,
      wins: 0
    };
  }).sort((a, b) => a.position - b.position);
  if (!mapped.length) return null;
  return {
    source: `OpenF1 · after ${lastRace.event} ${lastRace.name}`,
    provider: 'openf1',
    updatedAt: new Date().toISOString().slice(0, 10),
    drivers: mapped,
    teams: teamPoints.map((x) => ({ position: x.position_current, name: x.team_name, points: x.points_current })).sort((a, b) => a.position - b.position)
  };
}

async function getJolpicaStandings() {
  const year = new Date().getUTCFullYear();
  const [drivers, constructors] = await Promise.all([
    jolpica(`${year}/driverstandings.json`, 15 * 60 * 1000),
    jolpica(`${year}/constructorstandings.json`, 15 * 60 * 1000)
  ]);
  const driverRows = drivers?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const teamRows = constructors?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  if (!driverRows.length) return null;
  const round = drivers?.MRData?.StandingsTable?.round || '';
  return {
    source: `Jolpica · round ${round} of ${year}`,
    provider: 'jolpica',
    updatedAt: new Date().toISOString().slice(0, 10),
    drivers: driverRows.map((row) => {
      const code = row.Driver?.code || '';
      const fallback = getDriver(code) || getDriver(`${row.Driver?.givenName || ''} ${row.Driver?.familyName || ''}`);
      const teamName = row.Constructors?.[0]?.name || fallback?.team || '—';
      return {
        position: Number(row.position),
        name: fallback?.name || `${row.Driver?.givenName || ''} ${row.Driver?.familyName || ''}`.trim(),
        code: code || fallback?.code || '',
        team: teamName,
        headshotUrl: fallback?.photo || '',
        points: Number(row.points),
        wins: Number(row.wins) || 0
      };
    }),
    teams: teamRows.map((row) => ({
      position: Number(row.position),
      name: row.Constructor?.name || '—',
      points: Number(row.points)
    }))
  };
}

async function getStandings() {
  try {
    const data = await getOpenF1Standings();
    if (data?.drivers?.length) return data;
  } catch { /* next provider */ }
  try {
    const data = await getJolpicaStandings();
    if (data?.drivers?.length) return data;
  } catch { /* next provider */ }
  return null;
}

// --- Race timing ------------------------------------------------------------

async function getOpenF1Timing() {
  const sessions = await getOpenF1Sessions();
  const race = sessions.filter((s) => isGrandPrixRace(s) && Date.parse(s.endsAt) < Date.now()).at(-1);
  if (!race) return null;
  const [results, drivers] = await Promise.all([
    openF1(`session_result?session_key=${race.id}`, 15 * 60 * 1000),
    openF1(`drivers?session_key=${race.id}`, 15 * 60 * 1000)
  ]);
  const byNo = new Map(drivers.map((d) => [d.driver_number, d]));
  const rows = results.map((x) => {
    const d = byNo.get(x.driver_number) || {};
    const code = d.name_acronym || String(x.driver_number);
    const fallback = getDriver(code) || getDriver(d.full_name);
    const gap = x.position === 1 ? 'WINNER' : typeof x.gap_to_leader === 'number' ? `+${x.gap_to_leader.toFixed(3)} s` : String(x.gap_to_leader || '—');
    const dur = typeof x.duration === 'number' ? `${Math.floor(x.duration / 60)}:${(x.duration % 60).toFixed(3).padStart(6, '0')}` : '—';
    return {
      position: x.position,
      code,
      driver: d.full_name || fallback?.name || `Driver ${x.driver_number}`,
      team: d.team_name || fallback?.team || '—',
      headshotUrl: d.headshot_url || fallback?.photo || '',
      gap,
      time: x.position === 1 && dur !== '—' ? dur : `${x.number_of_laps || 0} laps`
    };
  }).sort((a, b) => a.position - b.position);
  return rows.length
    ? { source: 'OpenF1 · classified result', provider: 'openf1', session: `${race.event} · ${race.name}`, updatedAt: race.endsAt.slice(0, 10), rows }
    : null;
}

async function getJolpicaTiming() {
  const year = new Date().getUTCFullYear();
  const races = await getJolpicaRaces(year);
  const past = races.filter((r) => Date.parse(`${r.date}T${(r.time || '23:59:59Z').replace('Z', '')}Z`) < Date.now());
  const last = past.at(-1);
  if (!last) return null;
  const data = await jolpica(`${year}/${last.round}/results.json`, 15 * 60 * 1000);
  const race = data?.MRData?.RaceTable?.Races?.[0];
  const results = race?.Results || [];
  if (!results.length) return null;
  const rows = results.map((x) => {
    const code = x.Driver?.code || '';
    const fallback = getDriver(code) || getDriver(`${x.Driver?.givenName || ''} ${x.Driver?.familyName || ''}`);
    const finished = x.status === 'Finished' || String(x.status || '').startsWith('+');
    const time = x.Time?.time || '';
    const gap = Number(x.position) === 1 ? 'WINNER' : time ? `+${time.replace('+', '')} s` : String(x.status || '—');
    return {
      position: Number(x.position),
      code: code || fallback?.code || '',
      driver: fallback?.name || `${x.Driver?.givenName || ''} ${x.Driver?.familyName || ''}`.trim(),
      team: x.Constructor?.name || fallback?.team || '—',
      headshotUrl: fallback?.photo || '',
      gap,
      time: Number(x.position) === 1 && time ? `1:${time.slice(2)}`.replace('1:0', '1:0') : `${x.laps || 0} laps`,
      status: finished ? 'CLASSIFIED' : x.status
    };
  }).sort((a, b) => a.position - b.position);
  return {
    source: 'Jolpica · race classification',
    provider: 'jolpica',
    session: `${race.raceName} · Race classification`,
    updatedAt: race.date,
    rows
  };
}

async function getTiming() {
  try {
    const data = await getOpenF1Timing();
    if (data?.rows?.length) return data;
  } catch { /* next provider */ }
  try {
    const data = await getJolpicaTiming();
    if (data?.rows?.length) return data;
  } catch { /* next provider */ }
  return null;
}

// --- Weekend podium ---------------------------------------------------------

async function getWeekendResult(raceSession) {
  try {
    const [results, drivers] = await Promise.all([
      openF1(`session_result?session_key=${raceSession.id}&position<=3`, 60 * 60 * 1000),
      openF1(`drivers?session_key=${raceSession.id}`, 60 * 60 * 1000)
    ]);
    const byNo = new Map(drivers.map((d) => [d.driver_number, d]));
    const podium = results.filter((x) => Number.isFinite(x.position)).sort((a, b) => a.position - b.position).slice(0, 3).map((x) => {
      const d = byNo.get(x.driver_number) || {};
      const code = d.name_acronym || String(x.driver_number);
      const fallback = getDriver(code) || getDriver(d.full_name);
      return {
        position: x.position,
        code,
        name: d.full_name || fallback?.name || `Driver ${x.driver_number}`,
        team: d.team_name || fallback?.team || '—',
        teamColour: d.team_colour || fallback?.teamColour || getTeamColour(d.team_name),
        headshotUrl: d.headshot_url || fallback?.photo || ''
      };
    });
    if (podium.length) return { source: 'OpenF1', provider: 'openf1', winner: podium[0], podium, classified: results.length, laps: results[0]?.number_of_laps || null };
  } catch { /* fall through to Jolpica */ }

  try {
    const year = new Date().getUTCFullYear();
    const races = await getJolpicaRaces(year);
    const past = races.filter((r) => Date.parse(`${r.date}T23:59:59Z`) < Date.now());
    const last = past.at(-1);
    if (!last) return null;
    const data = await jolpica(`${year}/${last.round}/results.json`, 60 * 60 * 1000);
    const results = data?.MRData?.RaceTable?.Races?.[0]?.Results || [];
    const podium = results.slice(0, 3).map((x) => {
      const code = x.Driver?.code || '';
      const fallback = getDriver(code) || getDriver(`${x.Driver?.givenName || ''} ${x.Driver?.familyName || ''}`);
      return {
        position: Number(x.position),
        code: code || fallback?.code || '',
        name: fallback?.name || `${x.Driver?.givenName || ''} ${x.Driver?.familyName || ''}`.trim(),
        team: x.Constructor?.name || fallback?.team || '—',
        teamColour: getTeamColour(x.Constructor?.name || fallback?.team),
        headshotUrl: fallback?.photo || ''
      };
    });
    if (podium.length) return { source: 'Jolpica', provider: 'jolpica', winner: podium[0], podium, classified: results.length, laps: results[0]?.laps || null };
  } catch { /* nothing left */ }

  return null;
}

// --- Health -----------------------------------------------------------------

async function providerHealth() {
  const checks = {};
  const timed = async (name, fn) => {
    const started = Date.now();
    try {
      const detail = await fn();
      checks[name] = { ok: true, latencyMs: Date.now() - started, ...detail };
    } catch (e) {
      checks[name] = { ok: false, latencyMs: Date.now() - started, error: e.message };
    }
  };
  const year = new Date().getUTCFullYear();
  await Promise.all([
    timed('openf1', async () => {
      const sessions = await openF1(`sessions?year=${year}`, 60 * 1000);
      return { sessions: sessions.length };
    }),
    timed('jolpica', async () => {
      const data = await jolpica(`${year}/driverstandings.json`, 60 * 1000);
      return { drivers: data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.length || 0 };
    })
  ]);
  return checks;
}

module.exports = {
  OPENF1,
  JOLPICA,
  fetchJson,
  getSessions,
  getRaceControl,
  getStandings,
  getTiming,
  getWeekendResult,
  providerHealth,
  isGrandPrixRace
};
