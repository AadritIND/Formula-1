// The real-time feed.
//
// This connects to the live-timing service that formula1.com's own timing
// screen uses (a SignalR hub) and keeps one upstream connection for the whole
// site: every visitor reads this process's merged state instead of opening
// their own connection. It is only ever connected while a broadcast session is
// on air — see lib/sessionstate.js — so an idle week costs nothing.
//
// The wire format is a hub feed with keyframes and deltas:
//
//   * subscribing answers with one completion frame carrying the current state
//     of every topic;
//   * after that the hub pushes `feed` invocations with partial objects that
//     have to be merged into the state (a lap time here, a sector there);
//   * RaceControlMessages and TeamRadio arrive as arrays of *new* items, which
//     are appended rather than replacing what came before.
//
// It is an undocumented interface — F1 does not publish it and does not promise
// it — so the connector is defensive: it reconnects on its own, watches the
// heartbeat for silence, and never reports itself as live when it has no frames
// to show.

const crypto = require('node:crypto');

const SIGNAL = (process.env.APEX_SIGNAL_URL || 'https://livetiming.formula1.com/signalrcore').replace(/\/$/, '');
const STATIC_BASE = (process.env.APEX_SIGNAL_STATIC || 'https://livetiming.formula1.com/static/').replace(/\/(?!$)/, '/');
const USER_AGENT = process.env.APEX_SIGNAL_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const ORIGIN = process.env.APEX_SIGNAL_ORIGIN || 'https://www.formula1.com';
const STALE_MS = envInt('APEX_SIGNAL_STALE_MS', 45 * 1000);
const WAIT_MS = envInt('APEX_SIGNAL_WAIT_MS', 6000);
const TTL_MS = envInt('APEX_SIGNAL_TTL_MS', 1500);
const LINGER_MS = envInt('APEX_SIGNAL_LINGER_MS', 15 * 1000);
const HEARTBEAT_MS = envInt('APEX_SIGNAL_PING_MS', 20 * 1000);
// On a long-lived server the connection stays up for the whole session. On a
// serverless host each invocation gets its own short-lived one.
const PERSIST = process.env.APEX_SIGNAL_PERSIST ? process.env.APEX_SIGNAL_PERSIST !== '0' : !process.env.VERCEL;

const TOPICS = ['SessionInfo', 'SessionStatus', 'DriverList', 'TimingData', 'TimingAppData', 'LapCount', 'RaceControlMessages', 'TeamRadio', 'TrackStatus', 'Heartbeat'];
const APPEND_TOPICS = new Set(['RaceControlMessages', 'TeamRadio', 'RcmSeries']);

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- state ------------------------------------------------------------------

const feed = {
  connected: false,
  connecting: false,
  reconnects: 0,
  frames: 0,
  error: '',
  lastFrameAt: 0,
  connectedAt: 0,
  topics: Object.create(null)
};
const runs = { socket: null, watchdog: null, ping: null, linger: null, shouldRun: false, backoff: 1000, attempt: 0 };
const cache = { at: 0, value: null };
const bests = { session: { s1: null, s2: null, s3: null }, drivers: new Map() };

function resetState() {
  feed.topics = Object.create(null);
  bests.session = { s1: null, s2: null, s3: null };
  bests.drivers = new Map();
  cache.at = 0;
  cache.value = null;
}

// Deltas are partial objects: merge them into what came before instead of
// replacing it. Arrays of fixed slots (a lap's three sectors, the eight
// mini-sectors inside one) merge by index; everything else is an object or a
// scalar. A null means the value is gone.
function merge(target, patch) {
  if (patch === null || patch === undefined) return patch;
  if (Array.isArray(patch)) {
    const base = Array.isArray(target) ? target.slice() : [];
    for (let i = 0; i < patch.length; i++) {
      const value = patch[i];
      base[i] = value && typeof value === 'object' ? merge(base[i], value) : value;
    }
    return base;
  }
  if (typeof patch === 'object') {
    const base = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === '_kf') continue;
      base[key] = value && typeof value === 'object' ? merge(base[key], value) : value;
    }
    return base;
  }
  return patch;
}

// Appending arrays carry new items only, so they are added and de-duplicated
// (a reconnect replays the whole keyframe).
function appendTopic(topic, patch) {
  const current = feed.topics[topic] && typeof feed.topics[topic] === 'object' ? feed.topics[topic] : {};
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      const seen = new Set((Array.isArray(current[key]) ? current[key] : []).map(itemKey));
      const list = Array.isArray(current[key]) ? current[key].slice() : [];
      for (const item of value) {
        const id = itemKey(item);
        if (seen.has(id)) continue;
        seen.add(id);
        list.push(item);
      }
      next[key] = list.slice(-400);
    } else if (value && typeof value === 'object') {
      next[key] = merge(current[key], value);
    } else {
      next[key] = value;
    }
  }
  feed.topics[topic] = next;
}

function itemKey(item) {
  if (!item || typeof item !== 'object') return String(item);
  if (item.Path) return `p:${item.Path}`;
  if (item.Utc !== undefined && item.Message !== undefined) return `m:${item.Utc}:${item.Message}`;
  return `j:${JSON.stringify(item)}`;
}

function applyTopic(topic, payload) {
  if (!payload || typeof payload !== 'object') return;
  if (APPEND_TOPICS.has(topic)) {
    appendTopic(topic, payload);
    return;
  }
  feed.topics[topic] = merge(feed.topics[topic], payload);
}

// --- sector bookkeeping -----------------------------------------------------
//
// The fastest sector of a session was, when it was set, somebody's last-lap
// sector, so the minimum value seen while connected *is* the session best. The
// same minimum per driver gives their personal best. Doing it here means the
// tower's purple/green colouring works off the live feed with no extra source.

function noteSectors() {
  const lines = (feed.topics.TimingData && feed.topics.TimingData.Lines) || {};
  for (const [number, line] of Object.entries(lines)) {
    if (!line || typeof line !== 'object') continue;
    const sectors = Array.isArray(line.Sectors) ? line.Sectors : [];
    const mine = bests.drivers.get(number) || { s1: null, s2: null, s3: null };
    sectors.forEach((sector, index) => {
      const key = `s${index + 1}`;
      const value = lapSeconds(sector && sector.Value);
      if (value === null) return;
      if (mine[key] === null || value < mine[key]) mine[key] = value;
      if (bests.session[key] === null || value < bests.session[key]) bests.session[key] = value;
    });
    bests.drivers.set(number, mine);
  }
}

// --- parsing ----------------------------------------------------------------

// "1:36.201" / "28.631" / "" -> seconds, or null when there is no time.
function lapSeconds(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;
  const match = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  const total = minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? Math.round(total * 1000) / 1000 : null;
}

// SessionInfo times are circuit-local clock faces plus an offset.
function utcIso(local, offset) {
  if (!local) return null;
  const base = Date.parse(`${local}Z`);
  if (!Number.isFinite(base)) return null;
  const match = /^([+-]?)(\d{2}):(\d{2})/.exec(String(offset || '00:00'));
  const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(base - minutes * 60000).toISOString();
}

function driverInfo(number) {
  const list = feed.topics.DriverList || {};
  return list[String(number)] || {};
}

// --- the tower --------------------------------------------------------------

function buildDrivers() {
  const lines = (feed.topics.TimingData && feed.topics.TimingData.Lines) || {};
  const app = (feed.topics.TimingAppData && feed.topics.TimingAppData.Lines) || {};
  const currentLap = Number((feed.topics.LapCount || {}).CurrentLap) || 0;
  const out = [];
  for (const [number, line] of Object.entries(lines)) {
    if (!line || typeof line !== 'object' || line.Retired) continue;
    const info = driverInfo(number);
    const sectors = Array.isArray(line.Sectors) ? line.Sectors : [];
    const speeds = line.Speeds || {};
    // A delta can null out a stint slot, and a retired car's row has to survive
    // whatever shape it arrives in, so anything that is not an object is dropped
    // before it is read.
    const stints = (Array.isArray(app[number] && app[number].Stints) ? app[number].Stints : []).filter((s) => s && typeof s === 'object');
    const stint = stints.length ? stints[stints.length - 1] : null;
    const best = bests.drivers.get(number) || { s1: null, s2: null, s3: null };
    const lastValue = lapSeconds(line.LastLapTime && line.LastLapTime.Value);
    const rawGap = String((line.GapToLeader === undefined || line.GapToLeader === null) ? '' : line.GapToLeader).trim();
    const rawInterval = String((line.IntervalToPositionAhead && line.IntervalToPositionAhead.Value) || '').trim();
    const position = Number(line.Position) || Number(line.Line) || null;
    const stops = Number(line.NumberOfPitStops) || 0;
    out.push({
      number: Number(number),
      code: info.Tla || String(number),
      name: info.FullName || info.BroadcastName || '',
      team: info.TeamName || '',
      teamColour: info.TeamColour ? `#${info.TeamColour}` : '',
      headshot: info.HeadshotUrl || '',
      position,
      gapToLeader: position === 1 || !rawGap ? (position === 1 ? 'LEADER' : '—') : (rawGap.startsWith('+') || rawGap.endsWith('L') ? rawGap : `+${rawGap}`),
      interval: position === 1 ? '—' : (rawInterval ? (rawInterval.startsWith('+') || rawInterval.endsWith('L') ? rawInterval : `+${rawInterval}`) : null),
      laps: Number(line.NumberOfLaps) || 0,
      lastLap: {
        number: Number(line.NumberOfLaps) || null,
        time: lastValue,
        s1: lapSeconds(sectors[0] && sectors[0].Value),
        s2: lapSeconds(sectors[1] && sectors[1].Value),
        s3: lapSeconds(sectors[2] && sectors[2].Value),
        speedTrap: Number((speeds.ST || {}).Value) || null,
        pitOut: Boolean(line.PitOut)
      },
      bestLap: lapSeconds(line.BestLapTime && line.BestLapTime.Value) === null ? null : {
        time: lapSeconds(line.BestLapTime.Value),
        lap: Number(line.BestLapTime.Lap) || null
      },
      bestSectors: best,
      tyre: stint ? {
        compound: String(stint.Compound || '').toUpperCase(),
        ageLaps: Math.max(1, (currentLap || Number(stint.LapNumber) || 0) - (Number(stint.LapNumber) || 0) + 1) + (Number(stint.StartLaps) || 0),
        fittedLap: Number(stint.LapNumber) || null,
        stintNumber: stints.length,
        stints: stints.length,
        used: [...new Set(stints.map((s) => String((s && s.Compound) || '').toUpperCase()).filter(Boolean))]
      } : null,
      pits: { count: stops, last: null }
    });
  }
  return out;
}

function highlightFastest(drivers) {
  const timed = drivers.filter((d) => d.bestLap && d.bestLap.time);
  if (!timed.length) return null;
  const fastest = timed.reduce((a, b) => (b.bestLap.time < a.bestLap.time ? b : a));
  return { code: fastest.code, name: fastest.name, time: fastest.bestLap.time, lap: fastest.bestLap.lap };
}

function sessionSummary() {
  const info = feed.topics.SessionInfo || {};
  const meeting = info.Meeting || {};
  const circuit = (meeting.Circuit || {}).ShortName || '';
  const country = (meeting.Country || {}).Name || '';
  const offset = info.GmtOffset || '00:00:00';
  const name = String(info.Name || '').trim();
  const type = String(info.Type || '').trim();
  const label = !name || !type || name.toLowerCase() === type.toLowerCase() || name.toLowerCase().startsWith(type.toLowerCase())
    ? (name || type)
    : `${name} ${type}`;
  const start = utcIso(info.StartDate, offset);
  return {
    sessionKey: info.Key || null,
    sessionName: label || 'LIVE SESSION',
    sessionType: type,
    circuit,
    country,
    location: meeting.Location || '',
    year: start ? new Date(start).getUTCFullYear() : null,
    dateStart: start,
    dateEnd: utcIso(info.EndDate, offset),
    offset,
    meetingName: meeting.Name || '',
    meetingNumber: meeting.Number || null
  };
}

const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

function revisionOf(parts) {
  const text = JSON.stringify(parts);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// The payload the tower page already knows how to draw, built from the live
// feed. Same shape as the archive tower so the page needs no special case.
function towerPayload() {
  const drivers = buildDrivers().sort((a, b) => (a.position || 999) - (b.position || 999) || a.code.localeCompare(b.code));
  const summary = sessionSummary();
  const lap = Number((feed.topics.LapCount || {}).CurrentLap) || null;
  const totalLaps = Number((feed.topics.LapCount || {}).TotalLaps) || null;
  const bestSector = { s1: null, s2: null, s3: null };
  for (const key of ['s1', 's2', 's3']) {
    let winner = null;
    for (const driver of drivers) {
      const value = driver.bestSectors[key];
      if (value === null || value === undefined) continue;
      if (!winner || value < winner.value) winner = { value, code: driver.code };
    }
    bestSector[key] = winner;
  }
  const stops = drivers.filter((d) => d.pits.count > 0).sort((a, b) => b.pits.count - a.pits.count);
  const age = feed.lastFrameAt ? Math.max(0, Math.round((Date.now() - feed.lastFrameAt) / 1000)) : null;
  return {
    ...summary,
    source: 'F1 live timing · real time',
    live: true,
    inSession: true,
    simulated: false,
    feed: {
      connected: true,
      frames: feed.frames,
      ageSeconds: age,
      reconnects: feed.reconnects
    },
    lap,
    totalLaps,
    leaderLaps: lap,
    trackStatus: feed.topics.TrackStatus || null,
    updatedAt: new Date().toISOString(),
    drivers,
    highlights: {
      fastestLap: highlightFastest(drivers),
      bestSectors: bestSector,
      mostStops: stops.length ? { code: stops[0].code, count: stops[0].pits.count } : null,
      compounds: COMPOUNDS.filter((c) => drivers.some((d) => d.tyre && d.tyre.compound === c))
    },
    notes: 'Positions, gaps, sector times, tyres and team radio come straight from F1\u2019s live timing feed while the session is on.',
    revision: revisionOf([summary.sessionKey, lap, drivers.map((d) => [d.position, d.code, d.laps, d.gapToLeader, d.interval, d.lastLap.time, d.lastLap.s1, d.lastLap.s2, d.lastLap.s3, d.bestLap && d.bestLap.time, d.tyre && d.tyre.compound, d.tyre && d.tyre.ageLaps, d.pits.count])])
  };
}

// --- team radio -------------------------------------------------------------

function radioItems() {
  const info = feed.topics.SessionInfo || {};
  const path = String(info.Path || '');
  const captures = Array.isArray((feed.topics.TeamRadio || {}).Captures) ? feed.topics.TeamRadio.Captures : [];
  return captures
    .filter((capture) => capture && capture.Path)
    .map((capture) => {
      const info2 = driverInfo(capture.RacingNumber);
      const url = `${STATIC_BASE}${path}${String(capture.Path).replace(/^\//, '')}`;
      return {
        id: crypto.createHash('sha1').update(capture.Path).digest('hex').slice(0, 16),
        url,
        at: capture.Utc || '',
        driverNumber: Number(capture.RacingNumber),
        code: info2.Tla || String(capture.RacingNumber || ''),
        name: info2.FullName || '',
        team: info2.TeamName || '',
        teamColour: info2.TeamColour ? `#${info2.TeamColour}` : ''
      };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// --- the connection ---------------------------------------------------------

function wsUrl(token) {
  const url = new URL(SIGNAL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('id', token);
  return url.toString();
}

async function negotiate() {
  const res = await fetch(`${SIGNAL}/negotiate?negotiateVersion=1`, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, Origin: ORIGIN, 'Content-Length': '0' },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`the live feed refused the handshake (${res.status})`);
  const body = await res.json();
  const token = body.connectionToken || body.connectionId;
  if (!token) throw new Error('the live feed did not return a connection token');
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
    : '';
  return { token, cookies };
}

function send(socket, message) {
  socket.send(`${JSON.stringify(message)}\x1e`);
}

// Frames arrive as text for the JSON protocol, but a binary frame must not be
// mistaken for a broken connection.
function handleFrame(raw) {
  if (typeof raw === 'string') return parseFrames(raw);
  if (raw instanceof ArrayBuffer) return parseFrames(Buffer.from(new Uint8Array(raw)).toString('utf8'));
  if (ArrayBuffer.isView(raw)) return parseFrames(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8'));
  if (raw && typeof raw.arrayBuffer === 'function') {
    raw.arrayBuffer().then((buffer) => parseFrames(Buffer.from(buffer).toString('utf8'))).catch(() => undefined);
    return;
  }
  return undefined;
}

function parseFrames(text) {
  for (const part of text.split('\x1e')) {
    if (!part.trim()) continue;
    let message = null;
    try { message = JSON.parse(part); } catch { continue; }
    if (!message || typeof message !== 'object') continue;
    feed.frames += 1;
    feed.lastFrameAt = Date.now();
    if (message.type === 6) {
      // Hub ping — answer it or the connection is dropped.
      const socket = runs.socket;
      if (socket && socket.readyState === 1) socket.send('{"type":6}\x1e');
      continue;
    }
    if (message.type === 3 && message.result) {
      // The subscribing keyframe: the connection is now genuinely useful, so the
      // reconnect delay starts from scratch again.
      runs.backoff = 1000;
      feed.error = '';
      for (const [topic, payload] of Object.entries(message.result)) applyTopic(topic, payload);
      noteSectors();
      continue;
    }
    if (message.type === 1 && String(message.target).toLowerCase() === 'feed' && Array.isArray(message.arguments)) {
      const [topic, payload] = message.arguments;
      applyTopic(topic, payload);
      if (topic === 'TimingData' || topic === 'TimingAppData') noteSectors();
      continue;
    }
  }
}

function stopWatchdog() {
  clearInterval(runs.watchdog);
  clearInterval(runs.ping);
  runs.watchdog = null;
  runs.ping = null;
}

function close(socket) {
  try { socket.close(1000); } catch { /* already gone */ }
}

async function connect() {
  if (runs.socket || runs.connecting) return;
  runs.connecting = true;
  try {
    const { token, cookies } = await negotiate();
    if (!runs.shouldRun) return;
    const socket = new WebSocket(wsUrl(token), { headers: { 'User-Agent': USER_AGENT, Origin: ORIGIN, ...(cookies ? { Cookie: cookies } : {}) } });
    runs.socket = socket;
    runs.attempt += 1;
    socket.addEventListener('open', () => {
      // Accepting a socket is not the same as being able to use it, so the
      // reconnect delay is only reset once real frames arrive (see parseFrames).
      feed.connected = true;
      feed.connectedAt = Date.now();
      feed.lastFrameAt = Date.now();
      send(socket, { protocol: 'json', version: 1 });
      setTimeout(() => {
        if (runs.socket === socket && socket.readyState === 1) {
          send(socket, { type: 1, invocationId: String(runs.attempt), target: 'Subscribe', arguments: [TOPICS] });
        }
      }, 350);
    });
    try { socket.binaryType = 'arraybuffer'; } catch { /* not supported */ }
    socket.addEventListener('message', (event) => handleFrame(event.data));
    socket.addEventListener('error', () => {
      feed.error = 'the live feed connection errored';
    });
    socket.addEventListener('close', (event) => {
      feed.connected = false;
      if (runs.socket === socket) {
        runs.socket = null;
        stopWatchdog();
        if (runs.shouldRun) {
          feed.reconnects += 1;
          feed.error = feed.error || `the live feed closed the connection (${event.code || 'no code'})`;
          scheduleReconnect();
        }
      }
    });
    runs.ping = setInterval(() => {
      if (socket.readyState === 1) socket.send('{"type":6}\x1e');
    }, HEARTBEAT_MS);
    runs.watchdog = setInterval(() => {
      if (!runs.socket) return;
      if (Date.now() - feed.lastFrameAt > STALE_MS) {
        feed.error = 'the live feed went quiet';
        feed.connected = false;
        close(runs.socket);
      }
    }, 5000);
  } catch (error) {
    feed.connected = false;
    feed.error = error.message;
    if (runs.shouldRun) scheduleReconnect();
  } finally {
    runs.connecting = false;
  }
}

function scheduleReconnect() {
  if (!runs.shouldRun || runs.linger) return;
  const delay = runs.backoff;
  runs.backoff = Math.min(runs.backoff * 2, 15000);
  runs.linger = setTimeout(() => {
    runs.linger = null;
    if (runs.shouldRun) connect();
  }, delay);
}

// Start listening. Called while a broadcast session is on air.
function start() {
  if (runs.shouldRun) return { running: true, connected: feed.connected };
  runs.shouldRun = true;
  runs.backoff = 1000;
  resetState();
  connect();
  return { running: true, connected: false };
}

// Stop listening and drop the connection.
function stop() {
  runs.shouldRun = false;
  clearTimeout(runs.linger);
  runs.linger = null;
  stopWatchdog();
  const socket = runs.socket;
  runs.socket = null;
  if (socket) close(socket);
  feed.connected = false;
  return { running: false };
}

// What the session-state module asks: is the feed attached, and what does it
// say about the session it is attached to?
function verdict() {
  const summary = sessionSummary();
  const status = feed.topics.SessionStatus || {};
  const archive = (feed.topics.SessionInfo && feed.topics.SessionInfo.ArchiveStatus) || {};
  return {
    connected: feed.connected,
    running: runs.shouldRun,
    sessionKey: summary.sessionKey,
    sessionName: summary.sessionName,
    sessionType: summary.sessionType,
    circuit: summary.circuit,
    country: summary.country,
    meetingName: summary.meetingName,
    startsAt: summary.dateStart,
    endsAt: summary.dateEnd,
    gmtOffset: summary.offset,
    started: status.Started || '',
    status: status.Status || '',
    archiveStatus: archive.Status || '',
    frames: feed.frames,
    lastFrameAt: feed.lastFrameAt || null,
    ageSeconds: feed.lastFrameAt ? Math.max(0, Math.round((Date.now() - feed.lastFrameAt) / 1000)) : null,
    error: feed.error,
    reconnects: feed.reconnects
  };
}

function health() {
  return {
    running: runs.shouldRun,
    persist: PERSIST,
    endpoint: SIGNAL,
    connected: feed.connected,
    frames: feed.frames,
    reconnects: feed.reconnects,
    topics: Object.keys(feed.topics),
    drivers: Object.keys((feed.topics.TimingData && feed.topics.TimingData.Lines) || {}).length,
    radio: radioItems().length,
    session: verdict().sessionKey ? {
      key: verdict().sessionKey,
      name: verdict().sessionName,
      status: verdict().status,
      started: verdict().started,
      archiveStatus: verdict().archiveStatus
    } : null,
    ageSeconds: feed.lastFrameAt ? Math.max(0, Math.round((Date.now() - feed.lastFrameAt) / 1000)) : null,
    error: feed.error
  };
}

// Everything the site can show right now, or null while there is nothing to
// show. Reading never blocks when the feed is already running; a cold process
// waits for the subscribing keyframe, which arrives in about a second.
async function read({ waitMs = WAIT_MS, allowConnect = true } = {}) {
  if (!runs.shouldRun && allowConnect) start();
  const deadline = Date.now() + waitMs;
  const ready = () => feed.connected && Object.keys(feed.topics).length > 0;
  while (!ready() && Date.now() < deadline) {
    if (!runs.shouldRun) break;
    await sleep(150);
  }
  if (!ready()) return null;
  return snapshot();
}

function snapshot() {
  const now = Date.now();
  if (cache.value && now - cache.at < TTL_MS) return cache.value;
  const tower = towerPayload();
  const radio = radioItems();
  const value = {
    at: now,
    tower,
    radio,
    session: sessionSummary(),
    verdict: verdict()
  };
  cache.at = now;
  cache.value = value;
  return value;
}

// On a serverless host the connection must not outlive the request that opened
// it; on a long-lived server it is kept for the session.
function release() {
  if (PERSIST) return;
  setTimeout(() => {
    if (Date.now() - cache.at > LINGER_MS) stop();
  }, LINGER_MS + 1000).unref?.();
}

module.exports = { start, stop, read, snapshot, verdict, health, release, radioItems, PERSIST, TOPICS, _merge: merge };
