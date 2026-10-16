// Live timing tower.
//
// OpenF1 is the only realistic source for this: its schedule, laps (with the
// three sector times, speed traps and pit-out flags), stints (compound plus
// tyre age), pit stops (stationary and lane duration), positions and intervals
// are all free for historical sessions. OpenF1 defines a session as "live" from
// 30 minutes before it starts until 30 minutes after it ends, and live data
// needs a paid plan — so when the newest session is inside that window and no
// OPENF1_API_KEY is configured the tower falls back to the last saved
// classification instead of pretending to be live.
//
// The free tier allows 3 requests per second and 30 per minute, which is why
// every read is cached and the intervals endpoint is date-filtered: it returns
// tens of thousands of rows for a full race.

const store = require('./store');
const openf1 = require('./openf1');

const CACHE_TTL_MS = envInt('APEX_TIMING_TTL_MS', 45 * 1000);
const LIVE_WINDOW_MS = 30 * 60 * 1000;
const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
}

const state = { value: null, until: 0, inflight: null };

const api = (path) => openf1.api(path);

// OpenF1 uses null (and occasionally an empty string) for "no reading yet", and
// Number(null) is 0, so nullish values have to be rejected before the cast or a
// missing reading shows up as a real zero.
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Sector and lap times arrive as seconds with three decimals. A zero means the
// car was in the pit lane for that sector, so it is treated as no time at all.
function sector(value) {
  const n = num(value);
  return n === null || n <= 0 ? null : Math.round(n * 1000) / 1000;
}

// OpenF1 repeats the session type inside the session name ("Race" + "Race",
// "Practice 1" + "Practice"), which would read as "Race Race" on the page.
function sessionLabel(name, type) {
  const n = String(name || '').trim();
  const t = String(type || '').trim();
  if (!n) return t;
  if (!t || n.toLowerCase() === t.toLowerCase() || n.toLowerCase().startsWith(t.toLowerCase())) return n;
  return `${n} ${t}`;
}

function lastByDriver(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = Number(row.driver_number);
    if (!Number.isFinite(key)) continue;
    const existing = map.get(key);
    if (!existing || Date.parse(row.date || 0) >= Date.parse(existing.date || 0)) map.set(key, row);
  }
  return map;
}

// The intervals feed carries one row per driver every few seconds; a whole race
// is ~28k rows, so only the tail is pulled. The window has to be wide enough to
// include every driver's last reading (the leader's final gap is usually logged
// long before the flag), so it widens until it covers the field.
async function fetchIntervals(sessionKey, dataEndMs, expected) {
  let best = [];
  let bestCover = 0;
  for (const minutes of [10, 30, 60]) {
    const from = new Date(dataEndMs - minutes * 60 * 1000).toISOString();
    const rows = await api(`/intervals?session_key=${sessionKey}&date>=${from}`);
    const cover = new Set(rows.map((r) => Number(r.driver_number))).size;
    if (cover > bestCover) { best = rows; bestCover = cover; }
    if (rows.length && cover >= Math.min(expected, Math.max(3, Math.round(expected * 0.75)))) return rows;
  }
  return best;
}

function buildDriver(entry) {
  const { driver, laps, stint, stints, pits, position, interval } = entry;
  const timed = laps.filter((l) => sector(l.lap_duration) !== null);
  const best = timed.length ? timed.reduce((a, b) => (num(b.lap_duration) < num(a.lap_duration) ? b : a)) : null;
  const last = laps.length ? laps[laps.length - 1] : null;
  const bestSector = (key) => {
    const values = laps.map((l) => sector(l[key])).filter((v) => v !== null);
    return values.length ? Math.min(...values) : null;
  };
  const lastStop = pits.length ? pits[pits.length - 1] : null;
  return {
    number: Number(driver.driver_number),
    code: driver.name_acronym || String(driver.driver_number),
    name: driver.full_name || driver.broadcast_name || '',
    team: driver.team_name || '',
    teamColour: driver.team_colour ? `#${driver.team_colour}` : '',
    headshot: driver.headshot_url || '',
    position: position ? num(position.position) : null,
    gapToLeader: interval ? (interval.gap_to_leader === 0 ? 'LEADER' : (typeof interval.gap_to_leader === 'string' ? interval.gap_to_leader : `+${Number(interval.gap_to_leader).toFixed(3)}s`)) : null,
    interval: interval && num(interval.interval) !== null && num(interval.interval) > 0 ? `+${Number(interval.interval).toFixed(3)}s` : (interval && num(interval.interval) === 0 ? '—' : null),
    laps: last ? num(last.lap_number) : 0,
    lastLap: last ? {
      number: num(last.lap_number),
      time: num(last.lap_duration),
      s1: sector(last.duration_sector_1),
      s2: sector(last.duration_sector_2),
      s3: sector(last.duration_sector_3),
      speedTrap: num(last.st_speed),
      pitOut: Boolean(last.is_pit_out_lap)
    } : null,
    bestLap: best ? { time: num(best.lap_duration), lap: num(best.lap_number) } : null,
    bestSectors: { s1: bestSector('duration_sector_1'), s2: bestSector('duration_sector_2'), s3: bestSector('duration_sector_3') },
    tyre: stint ? {
      compound: stint.compound || '',
      ageLaps: Math.max(0, (last ? Number(last.lap_number) : Number(stint.lap_end) || 0) - Number(stint.lap_start) + 1) + Number(stint.tyre_age_at_start || 0),
      fittedLap: num(stint.lap_start),
      stintNumber: num(stint.stint_number),
      stints: stints.length,
      used: [...new Set(stints.map((s) => s.compound).filter(Boolean))]
    } : null,
    pits: {
      count: pits.length,
      last: lastStop ? {
        lap: num(lastStop.lap_number),
        // The feed fills pit_duration (time in the box) on newer sessions and
        // stop_duration on others, and lane_duration is the whole pit lane; any
        // of them can be null, so fall through in order of usefulness.
        stop: [num(lastStop.pit_duration), num(lastStop.stop_duration)].find((v) => v !== null && v > 0) ?? null,
        lane: num(lastStop.lane_duration),
        stationary: num(lastStop.stop_duration)
      } : null
    }
  };
}

function highlightFastest(drivers) {
  const withLaps = drivers.filter((d) => d.bestLap && d.bestLap.time);
  if (!withLaps.length) return null;
  const fastest = withLaps.reduce((a, b) => (b.bestLap.time < a.bestLap.time ? b : a));
  return { code: fastest.code, name: fastest.name, time: fastest.bestLap.time, lap: fastest.bestLap.lap };
}

function publicPayload(built) {
  const drivers = built.drivers.slice().sort((a, b) => {
    const pa = a.position === null ? 999 : a.position;
    const pb = b.position === null ? 999 : b.position;
    return pa - pb || a.code.localeCompare(b.code);
  });
  const bestSector = { s1: null, s2: null, s3: null };
  for (const key of ['s1', 's2', 's3']) {
    let winner = null;
    for (const d of drivers) {
      const value = d.bestSectors[key];
      if (value === null) continue;
      if (!winner || value < winner.value) winner = { value, code: d.code };
    }
    bestSector[key] = winner;
  }
  const pits = drivers.filter((d) => d.pits.count > 0).sort((a, b) => b.pits.count - a.pits.count);
  return {
    ...built.session,
    source: built.source,
    live: built.live,
    simulated: built.simulated,
    updatedAt: new Date().toISOString(),
    drivers,
    highlights: {
      fastestLap: highlightFastest(drivers),
      bestSectors: bestSector,
      mostStops: pits.length ? { code: pits[0].code, count: pits[0].pits.count } : null,
      compounds: COMPOUNDS.filter((c) => drivers.some((d) => d.tyre && d.tyre.compound === c))
    },
    notes: built.notes
  };
}

// Last-resort tower: the saved classification in the store, enriched with the
// same shape so the page renders (clearly labelled, never passed off as live).
function snapshotPayload(notes) {
  const db = store.getDoc();
  const rows = (db.timing && Array.isArray(db.timing.rows) ? db.timing.rows : []).slice(0, 20);
  const drivers = rows.map((row, index) => ({
    number: index + 1,
    code: row.code || String(index + 1),
    name: row.driver || '',
    team: row.team || '',
    teamColour: '',
    headshot: '',
    position: Number(row.position) || index + 1,
    gapToLeader: row.gap || '—',
    interval: null,
    laps: 0,
    lastLap: null,
    bestLap: null,
    bestSectors: { s1: null, s2: null, s3: null },
    tyre: null,
    pits: { count: 0, last: null }
  }));
  return {
    sessionName: (db.timing && db.timing.session) || 'SAVED CLASSIFICATION',
    sessionType: 'Snapshot',
    circuit: '',
    country: '',
    lap: null,
    dateStart: db.timing && db.timing.updatedAt,
    source: 'APEX saved snapshot',
    live: false,
    simulated: true,
    updatedAt: new Date().toISOString(),
    drivers,
    highlights: { fastestLap: null, bestSectors: { s1: null, s2: null, s3: null }, mostStops: null, compounds: [] },
    notes
  };
}

async function build() {
  const sessions = await api('/sessions?session_key=latest');
  if (!sessions.length) return snapshotPayload('OpenF1 has no sessions yet; showing the saved classification.');
  const session = sessions[0];
  const key = session.session_key;
  const now = Date.now();
  const start = Date.parse(session.date_start || 0);
  const end = Date.parse(session.date_end || 0);
  const live = now >= start - LIVE_WINDOW_MS && now <= end + LIVE_WINDOW_MS;
  if (live && !openf1.hasKey) {
    return snapshotPayload('This session is inside OpenF1\u2019s live window, which needs a paid plan; showing the saved classification.');
  }
  const dataEnd = live ? now : end;
  // Drivers first: the interval window is sized from the size of the field.
  const drivers = await api(`/drivers?session_key=${key}`);
  if (!drivers.length) return snapshotPayload('OpenF1 returned no driver list for the latest session.');
  const [laps, stints, pit, position, intervals] = await Promise.all([
    api(`/laps?session_key=${key}`),
    api(`/stints?session_key=${key}`),
    api(`/pit?session_key=${key}`),
    api(`/position?session_key=${key}`),
    fetchIntervals(key, dataEnd, drivers.length)
  ]);

  const lapsByDriver = new Map();
  for (const lap of laps) {
    const list = lapsByDriver.get(Number(lap.driver_number)) || [];
    list.push(lap);
    lapsByDriver.set(Number(lap.driver_number), list);
  }
  for (const list of lapsByDriver.values()) list.sort((a, b) => Number(a.lap_number) - Number(b.lap_number));
  const stintsByDriver = new Map();
  for (const stint of stints) {
    const list = stintsByDriver.get(Number(stint.driver_number)) || [];
    list.push(stint);
    stintsByDriver.set(Number(stint.driver_number), list);
  }
  for (const list of stintsByDriver.values()) list.sort((a, b) => Number(a.stint_number) - Number(b.stint_number));
  const pitsByDriver = new Map();
  for (const stop of pit) {
    const list = pitsByDriver.get(Number(stop.driver_number)) || [];
    list.push(stop);
    pitsByDriver.set(Number(stop.driver_number), list);
  }
  for (const list of pitsByDriver.values()) list.sort((a, b) => Number(a.lap_number) - Number(b.lap_number));

  const positionByDriver = lastByDriver(position);
  const intervalByDriver = lastByDriver(intervals);
  const built = drivers.map((driver) => {
    const number = Number(driver.driver_number);
    const driverStints = stintsByDriver.get(number) || [];
    return buildDriver({
      driver,
      laps: lapsByDriver.get(number) || [],
      stints: driverStints,
      stint: driverStints.length ? driverStints[driverStints.length - 1] : null,
      pits: pitsByDriver.get(number) || [],
      position: positionByDriver.get(number),
      interval: intervalByDriver.get(number)
    });
  });

  const lapNow = Math.max(0, ...built.map((d) => d.laps || 0));
  return publicPayload({
    session: {
      sessionKey: key,
      sessionName: sessionLabel(session.session_name, session.session_type),
      sessionType: session.session_type || '',
      circuit: session.circuit_short_name || '',
      country: session.country_name || '',
      location: session.location || '',
      year: session.year || null,
      dateStart: session.date_start || '',
      dateEnd: session.date_end || '',
      lap: lapNow || null,
      leaderLaps: lapNow || null
    },
    source: `OpenF1 · ${live ? 'live' : 'historical data'}`,
    live,
    simulated: false,
    drivers: built,
    notes: live ? 'Live access via the configured OpenF1 plan.' : 'OpenF1 frees historical sessions; the newest one is shown.'
  });
}

async function getTiming() {
  const now = Date.now();
  if (state.value && state.until > now) return state.value;
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const payload = await build();
      state.value = payload;
      state.until = Date.now() + CACHE_TTL_MS;
      return payload;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

module.exports = { getTiming, COMPOUNDS };
