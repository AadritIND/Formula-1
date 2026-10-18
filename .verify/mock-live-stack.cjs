// Verification harness for the live path. NOT part of the site.
//
// Two servers, one process:
//
//   :4010  a stand-in for OpenF1 — the session schedule (so the site's own
//          session-state logic decides when it is on air) and minimal archive
//          data. /control?mode=<idle|live|testing|quali|finish> switches what
//          the timetable says, so one running site can be driven through every
//          gating case.
//   :4011  a stand-in for F1's live-timing hub — negotiate + WebSocket, serving
//          the real snapshot captured from the live feed as the subscribing
//          keyframe, then scripted deltas (a position swap, a new lap, a new
//          team-radio capture). Counts connections, so a test can prove that
//          nothing connects while no session is on air.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OPENF1_PORT = Number(process.env.MOCK_OPENF1_PORT || 4010);
const SIGNAL_PORT = Number(process.env.MOCK_SIGNAL_PORT || 4011);
// Each session the mock can put on air has its own key, as the real service
// does — a finished session and a running one are never the same session.
const KEYS = { idle: 900001, live: 900001, finish: 900001, quali: 900002, sprintquali: 900003, testing: 900004 };
const SESSION_KEY = 900001;
const MEETING_KEY = 9099;

const state = { mode: process.env.MOCK_MODE || 'idle', signalConnections: 0, deltaIndex: 0, sockets: new Set() };
const activeKey = () => KEYS[state.mode] || SESSION_KEY;

const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'f1-snapshot.json'), 'utf8'));

function iso(ms) { return new Date(ms).toISOString(); }

function session(over) {
  const now = Date.now();
  return {
    session_key: activeKey(),
    meeting_key: MEETING_KEY,
    session_name: 'Race',
    session_type: 'Race',
    meeting_name: 'United States Grand Prix',
    location: 'Austin',
    country_name: 'United States',
    circuit_short_name: 'Austin',
    circuit_key: 9,
    date_start: iso(now - 10 * 60 * 1000),
    date_end: iso(now + 50 * 60 * 1000),
    gmt_offset: '-05:00:00',
    is_cancelled: false,
    round_number: 18,
    year: 2026,
    ...over
  };
}

// The three timetable shapes the site has to tell apart.
function schedule() {
  const now = Date.now();
  const later = session({
    session_key: 910001,
    session_name: 'Practice 1',
    session_type: 'Practice',
    date_start: iso(now + 48 * 3600 * 1000),
    date_end: iso(now + 49 * 3600 * 1000)
  });
  const finished = session({
    session_key: 910002,
    session_name: 'Race',
    session_type: 'Race',
    meeting_name: 'Singapore Grand Prix',
    location: 'Marina Bay',
    circuit_short_name: 'Singapore',
    date_start: iso(now - 6 * 24 * 3600 * 1000),
    date_end: iso(now - 6 * 24 * 3600 * 1000 + 2 * 3600 * 1000)
  });
  if (state.mode === 'testing') {
    return [finished, session({ session_name: 'Day 2', session_type: 'Testing' }), later];
  }
  if (state.mode === 'live' || state.mode === 'finish') {
    return [finished, session(), later];
  }
  if (state.mode === 'quali') {
    return [finished, session({ session_name: 'Qualifying', session_type: 'Qualifying' }), later];
  }
  if (state.mode === 'sprintquali') {
    return [finished, session({ session_name: 'Sprint Qualifying', session_type: 'Qualifying' }), later];
  }
  return [finished, later];
}

function send(res, body, type = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(text);
}

const openf1 = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const mode = url.searchParams.get('mode');
  if (mode) {
    state.mode = mode;
    console.log(`[openf1] mode -> ${mode}`);
    return send(res, { ok: true, mode });
  }
  const p = url.pathname;
  if (p === '/v1/sessions') {
    if (url.searchParams.get('session_key') === 'latest') {
      const wanted = activeKey();
      const list = schedule();
      return send(res, list.filter((s) => s.session_key === wanted).length ? list.filter((s) => s.session_key === wanted) : list.slice(0, 1));
    }
    return send(res, schedule());
  }
  // Archive endpoints: enough shape for the fallback tower to build.
  if (p === '/v1/drivers') {
    return send(res, Object.entries(real.DriverList).map(([number, d]) => ({
      driver_number: Number(number), name_acronym: d.Tla, full_name: d.FullName, team_name: d.TeamName,
      team_colour: d.TeamColour, headshot_url: d.HeadshotUrl, session_key: SESSION_KEY
    })));
  }
  if (p === '/v1/laps') {
    return send(res, Object.values(real.DriverList).slice(0, 20).map((d, i) => ({
      driver_number: Number(d.RacingNumber), lap_number: 20 + i, lap_duration: 95 + i / 100,
      duration_sector_1: 28 + i / 100, duration_sector_2: 40 + i / 100, duration_sector_3: 27 + i / 100,
      st_speed: 300 + i, is_pit_out_lap: false, date: iso(Date.now() - i * 1000)
    })));
  }
  if (p === '/v1/stints') {
    return send(res, Object.values(real.DriverList).slice(0, 20).map((d) => ({
      driver_number: Number(d.RacingNumber), stint_number: 1, compound: 'MEDIUM', lap_start: 1, lap_end: 30, tyre_age_at_start: 0
    })));
  }
  if (p === '/v1/pit' || p === '/v1/position' || p === '/v1/intervals' || p === '/v1/team_radio') return send(res, []);
  if (p === '/v1/race_control') return send(res, [{ date: iso(Date.now()), category: 'SessionStatus', message: 'SESSION STARTED', session_key: SESSION_KEY }]);
  return send(res, []);
});

// --- the live hub -----------------------------------------------------------

function liveSnapshot(lap) {
  const snap = JSON.parse(JSON.stringify(real));
  const now = Date.now();
  const local = (ms) => new Date(ms).toISOString().replace(/(\.\d+)?Z$/, '');
  snap.SessionInfo.Key = activeKey();
  snap.SessionInfo.Meeting.Key = MEETING_KEY;
  snap.SessionInfo.Meeting.Name = 'United States Grand Prix';
  snap.SessionInfo.Meeting.Location = 'Austin';
  snap.SessionInfo.Meeting.Circuit = { Key: 9, ShortName: 'Austin' };
  snap.SessionInfo.Meeting.Country = { Key: 1, Code: 'USA', Name: 'United States' };
  snap.SessionInfo.StartDate = local(now - 10 * 60 * 1000);
  snap.SessionInfo.EndDate = local(now + 50 * 60 * 1000);
  snap.SessionInfo.GmtOffset = '00:00:00';
  snap.SessionInfo.Path = '2026/2026-10-25_United_States_Grand_Prix/2026-10-25_Race/';
  snap.SessionInfo.ArchiveStatus = state.mode === 'finish' ? { Status: 'Complete' } : { Status: 'Generating' };
  snap.SessionInfo.SessionStatus = state.mode === 'finish' ? 'Finalised' : 'Started';
  snap.SessionStatus = state.mode === 'finish'
    ? { Status: 'Ends', Started: 'Finished' }
    : { Status: 'Started', Started: 'Started' };
  snap.LapCount = { CurrentLap: lap, TotalLaps: 57 };
  // Racing numbers must be ones that exist in the captured session, or the
  // driver lookup legitimately has nothing to name them with.
  snap.TeamRadio = { Captures: [
    { Utc: new Date(now - 40 * 1000).toISOString(), RacingNumber: '3', Path: 'TeamRadio/VER_3_20261025_140100.mp3' },
    { Utc: new Date(now - 20 * 1000).toISOString(), RacingNumber: '1', Path: 'TeamRadio/NOR_1_20261025_140120.mp3' }
  ] };
  return snap;
}

// Scripted deltas, in the hub's own shape: partial objects to merge. Each cycle
// of four frames moves the session on a lap and adds a fresh radio call, so a
// reading really does change while the page watches it.
function deltaFrames(cycle) {
  const now = Date.now();
  const lap = 31 + cycle;
  return [
    ['TimingData', { Lines: { '4': { Position: '1', GapToLeader: '', IntervalToPositionAhead: { Value: '', Catching: false }, NumberOfLaps: 31, LastLapTime: { Value: '1:35.900', Status: 1, OverallFastest: true }, Sectors: [{ Value: '28.100' }, { Value: '40.900' }, { Value: '27.900' }] } } }],
    ['TimingData', { Lines: {
      '3': { Position: '2', GapToLeader: '+0.412', IntervalToPositionAhead: { Value: '+0.412' }, NumberOfLaps: 31 },
      '16': { Position: '3', GapToLeader: `+${(7.335 + cycle / 100).toFixed(3)}`, LastLapTime: { Value: `1:36.${String(100 + cycle).padStart(3, '0')}` } }
    } }],
    ['TimingAppData', { Lines: { '4': { Stints: [null, { LapFlags: 1, Compound: 'HARD', New: 'true', TotalLaps: 1, StartLaps: 0, LapTime: '1:35.900', LapNumber: 30 }] } } }],
    ['LapCount', { CurrentLap: lap }],
    ['TeamRadio', { Captures: [{ Utc: new Date(now).toISOString(), RacingNumber: '16', Path: `TeamRadio/LEC_16_20261025_1402${String(cycle % 60).padStart(2, '0')}.mp3` }] }],
    ['RaceControlMessages', { Messages: [{ Utc: new Date(now).toISOString(), Lap: lap, Category: 'Flag', Message: `YELLOW IN SECTOR ${1 + (cycle % 3)}` }] }]
  ];
}

const signal = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.endsWith('/negotiate')) {
    return send(res, {
      negotiateVersion: 1,
      connectionId: crypto.randomBytes(8).toString('hex'),
      connectionToken: crypto.randomBytes(8).toString('hex'),
      availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }]
    });
  }
  if (url.pathname === '/connections') return send(res, { connections: state.signalConnections, mode: state.mode });
  res.writeHead(404).end();
});

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    // The subscribing keyframe is a six-figure byte count, exactly as the real
    // hub sends it, so the 64-bit length form is the one that matters.
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function readFrames(buffer) {
  const out = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let start = offset + 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      start = offset + 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      start = offset + 10;
    }
    const masked = Boolean(second & 0x80);
    const maskLength = masked ? 4 : 0;
    if (start + maskLength + length > buffer.length) break;
    const mask = masked ? buffer.subarray(start, start + 4) : null;
    const payload = Buffer.from(buffer.subarray(start + maskLength, start + maskLength + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    out.push({ opcode: first & 0x0f, payload });
    offset = start + maskLength + length;
  }
  return { frames: out, rest: buffer.subarray(offset) };
}

signal.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  state.signalConnections += 1;
  state.sockets.add(socket);
  const id = state.signalConnections;
  console.log(`[signal] connection #${id} opened (mode=${state.mode})`);
  let buffer = Buffer.alloc(0);
  let ticking = null;
  const send = (message) => { if (!socket.destroyed) socket.write(encodeFrame(`${JSON.stringify(message)}\x1e`)); };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = readFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.opcode === 8) { socket.end(); continue; }
      if (frame.opcode !== 1) continue;
      for (const part of frame.payload.toString('utf8').split('\x1e')) {
        if (!part.trim()) continue;
        let message = null;
        try { message = JSON.parse(part); } catch { continue; }
        if (message.protocol) { send({ type: 1, target: 'Handshake' }); continue; }
        if (message.target === 'Subscribe') {
          console.log('[signal] subscribe -> keyframe');
          send({ type: 3, invocationId: message.invocationId, result: liveSnapshot(31) });
          let index = 0;
          let finished = false;
          ticking = setInterval(() => {
            // When the timetable is switched to "finish", the hub does what the
            // real one does: it says the session has ended.
            if (state.mode === 'finish' && !finished) {
              finished = true;
              console.log('[signal] session finished frame');
              send({ type: 1, target: 'feed', arguments: ['SessionStatus', { Status: 'Ends', Started: 'Finished' }] });
              send({ type: 1, target: 'feed', arguments: ['SessionInfo', { SessionStatus: 'Finalised', ArchiveStatus: { Status: 'Complete' } }] });
              return;
            }
            if (state.mode !== 'finish') finished = false;
            const script = deltaFrames(Math.floor(index / 6));
            const [topic, payload] = script[index % script.length];
            index += 1;
            send({ type: 1, target: 'feed', arguments: [topic, payload] });
          }, 700);
        }
      }
    }
  });
  const clean = () => {
    if (ticking) clearInterval(ticking);
    state.sockets.delete(socket);
    console.log(`[signal] connection #${id} closed`);
  };
  socket.on('close', clean);
  socket.on('error', clean);
});

openf1.listen(OPENF1_PORT, '127.0.0.1', () => console.log(`mock OpenF1 on http://127.0.0.1:${OPENF1_PORT}/v1`));
signal.listen(SIGNAL_PORT, '127.0.0.1', () => console.log(`mock live hub on http://127.0.0.1:${SIGNAL_PORT}/signalrcore`));
