// Live timing tower.
//
// Two sources, in this order:
//
//   1. While a broadcast session is on air, the tower is built from the
//      real-time feed in lib/livesignal.js — F1's own live timing, pushed as it
//      happens, with sector times, tyres, pit counts and lap numbers. Reading it
//      costs no upstream requests, so the tower can be as fresh as the feed.
//   2. Otherwise (and if the feed has nothing to show), the last completed
//      session comes from OpenF1's free archive: laps with the three sector
//      times, stints, pit stops, positions and intervals. OpenF1 calls a session
//      "live" from 30 minutes before it starts until 30 minutes after it ends,
//      and live reads there need a paid plan — so inside that window without an
//      OPENF1_API_KEY the tower falls back to the saved classification rather
//      than pretending to be live.
//
// The free tier allows 3 requests per second and 30 per minute, which is why
// every archive read is cached and the intervals endpoint is date-filtered: it
// returns tens of thousands of rows for a full race.

const store = require('./store');
const openf1 = require('./openf1');
const livesignal = require('./livesignal');
const sessionstate = require('./sessionstate');

// A finished session cannot change, so it is held for a long time. A live feed
// pushes changes dozens of times a minute, so its reading is held just long
// enough to answer the second-by-second poll — the page repaints whenever the
// revision moves.
const CACHE_TTL_MS = envInt('APEX_TIMING_TTL_MS', 45 * 1000);
const LIVE_TTL_MS = envInt('APEX_TIMING_LIVE_TTL_MS', 1000);
const LIVE_WINDOW_MS = 30 * 60 * 1000;
const FEED_WAIT_MS = envInt('APEX_TIMING_FEED_WAIT_MS', 6000);
// How long after the flag the feed's own last reading is still the best
// classification available: OpenF1 does not publish the archive for another
// half hour, and the saved snapshot is older than what we watched.
const FINAL_WINDOW_MS = envInt('APEX_TIMING_FINAL_WINDOW_MS', 60 * 60 * 1000);
const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
}

const state = { value: null, until: 0, inflight: null };

// A short fingerprint of everything the tower draws. The page asks once a
// second, so it compares this and repaints the table only when a reading has
// actually changed instead of rebuilding 20 rows every tick.
function revisionOf(payload) {
  const text = JSON.stringify([
    payload.sessionKey,
    payload.sessionName,
    payload.lap,
    payload.drivers.map((d) => [
      d.position, d.code, d.laps, d.gapToLeader, d.interval,
      d.lastLap && d.lastLap.time, d.lastLap && d.lastLap.s1, d.lastLap && d.lastLap.s2, d.lastLap && d.lastLap.s3,
      d.lastLap && d.lastLap.speedTrap, d.bestLap && d.bestLap.time,
      d.tyre && d.tyre.compound, d.tyre && d.tyre.ageLaps, d.pits && d.pits.count
    ])
  ]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

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
    // True only while the session itself is running (OpenF1's "live" flag also
    // covers the half hour either side of it).
    inSession: Boolean(built.inSession),
    simulated: built.simulated,
    updatedAt: new Date().toISOString(),
    drivers,
    highlights: {
      fastestLap: highlightFastest(drivers),
      bestSectors: bestSector,
      mostStops: pits.length ? { code: pits[0].code, count: pits[0].pits.count } : null,
      compounds: COMPOUNDS.filter((c) => drivers.some((d) => d.tyre && d.tyre.compound === c))
    },
    notes: built.notes,
    revision: revisionOf({ ...built.session, drivers })
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
    inSession: false,
    simulated: true,
    updatedAt: new Date().toISOString(),
    drivers,
    highlights: { fastestLap: null, bestSectors: { s1: null, s2: null, s3: null }, mostStops: null, compounds: [] },
    notes,
    revision: `snapshot-${rows.length}-${(db.timing && db.timing.updatedAt) || ''}`
  };
}

// While a broadcast session is on air the real-time feed owns the tower. If it
// has not sent anything yet, the panel says so in plain words and the archive
// reading stands in — never the other way round.
function freshness(payload, cacheMs) {
  const at = new Date().toISOString();
  return {
    ...payload,
    refreshedAt: at,
    updatedAt: at,
    cacheMs,
    nextReadAt: new Date(Date.now() + cacheMs).toISOString()
  };
}

async function livePayload(session) {
  const live = await livesignal.read({ waitMs: FEED_WAIT_MS });
  if (!live || !live.tower || !live.tower.drivers.length) return null;
  // Only the session the state says is on air. A window opens a few minutes
  // before the lights, and the feed is still holding the previous session for
  // part of that time: showing that as "live" would be a lie about which session
  // the running order belongs to.
  const wanted = session && session.session && session.session.id;
  const got = live.session && live.session.sessionKey;
  if (wanted && got && String(wanted) !== String(got)) return null;
  return freshness(live.tower, LIVE_TTL_MS);
}

// The minutes after the chequered flag: the feed's final running order is kept
// on the panel until the archive supersedes it, rather than dropping to an older
// saved classification. A session that ends early, or runs long, must still
// qualify — so this asks the feed whether it has finished the session it was
// watching, and never relies on the timetable's idea of when it would end.
function finalPayload(session) {
  const live = livesignal.snapshot();
  if (!live || !live.tower || !live.tower.drivers.length) return null;
  const shown = session && session.session;
  const watched = live.session && live.session.sessionKey;
  if (!shown || !watched || String(shown.id) !== String(watched)) return null;
  const verdict = live.verdict || {};
  const started = String(verdict.started || '').toLowerCase();
  const archived = String(verdict.archiveStatus || '').toLowerCase();
  if (started !== 'finished' && started !== 'aborted' && archived !== 'complete') return null;
  const begun = Date.parse(live.session.dateStart || '');
  if (!Number.isFinite(begun) || Date.now() - begun > FINAL_WINDOW_MS * 12) return null;
  return freshness({
    ...live.tower,
    live: false,
    inSession: false,
    feed: null,
    source: 'F1 live timing \u00b7 final classification',
    notes: 'The session has finished. This is the final running order exactly as the live feed left it.'
  }, CACHE_TTL_MS);
}

async function archivePayload(state, wantedLive) {
  const sessions = await api('/sessions?session_key=latest');
  if (!sessions.length) {
    return snapshotPayload(wantedLive
      ? 'A session is on air, but the live feed has not delivered any timing yet.'
      : 'OpenF1 has no sessions yet; showing the saved classification.');
  }
  const session = sessions[0];
  const key = session.session_key;
  const now = Date.now();
  const start = Date.parse(session.date_start || 0);
  const end = Date.parse(session.date_end || 0);
  const live = now >= start - LIVE_WINDOW_MS && now <= end + LIVE_WINDOW_MS;
  if (live && !openf1.hasKey) {
    return snapshotPayload(wantedLive
      ? `A session is on air and the live feed is not delivering timing yet${livesignal.health().error ? ` (${livesignal.health().error})` : ''}. OpenF1 publishes a session in progress only on its paid plan, so the tower below is the last completed session.`
      : 'This session is inside OpenF1\u2019s live window, which needs a paid plan; showing the saved classification.');
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
  const payload = publicPayload({
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
    inSession: now >= start && now <= end,
    simulated: false,
    drivers: built,
    notes: live ? 'Live access via the configured OpenF1 plan.' : 'OpenF1 frees historical sessions; the newest one is shown.'
  });
  // The session state has the final word on whether anything is on air: outside
  // a broadcast session the tower is an archive reading, whatever OpenF1's own
  // ±30 minute window says.
  if (state && !state.live) {
    payload.live = false;
    payload.inSession = false;
  } else if (state && state.live) {
    payload.inSession = true;
    payload.onAir = true;
  }
  return payload;
}

// How long this reading stays valid: a live tower is re-read every second (it
// comes from memory), an archive reading is held for the full cache time — but
// never past the moment the session state says something could change, so the
// tower switches to the live feed as soon as the session starts.
function ttlFor(payload, state) {
  const nominal = payload && (payload.feed && payload.feed.connected || payload.inSession) ? LIVE_TTL_MS : CACHE_TTL_MS;
  const changeAt = state && Date.parse(state.nextChangeAt || '');
  if (!Number.isFinite(changeAt)) return nominal;
  return Math.max(1000, Math.min(nominal, changeAt - Date.now() + 500));
}

async function getTiming() {
  const now = Date.now();
  if (state.value && state.until > now) return state.value;
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      // The session state is what decides whether the feed is used at all, so it
      // is read first and handed to the cache timer.
      const session = await sessionstate.getSessionState();
      let payload;
      if (session.live) {
        payload = (await livePayload(session)) || (await archivePayload(session, true));
      } else {
        // Read what the feed left behind before the connection is dropped.
        payload = finalPayload(session);
        livesignal.stop();
        if (!payload) payload = await archivePayload(session, false);
      }
      // The page polls once a second; these tell it how fresh the reading is and
      // when the next upstream read is due, so the panel never claims to be
      // live when it is holding a cached answer.
      payload.refreshedAt = payload.updatedAt;
      payload.onAir = Boolean(session.live);
      payload.cacheMs = ttlFor(payload, session);
      payload.nextReadAt = new Date(Date.now() + payload.cacheMs).toISOString();
      state.value = payload;
      state.until = Date.now() + payload.cacheMs;
      return payload;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

module.exports = { getTiming, COMPOUNDS };
