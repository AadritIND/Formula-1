// Team radio panel.
//
// While a broadcast session is on air, the calls come from the real-time feed
// (lib/livesignal.js): F1 publishes a capture a few seconds after the driver
// speaks, with the driver and the address of the recording, and the panel is
// asked about it far more often during a session than outside one. Between
// sessions the same panel reads OpenF1's archive for the last session.
//
// Groq's Whisper models transcribe audio cheaply. Two things shape the design:
//
//   * The audio is Formula 1's copyright. F1's own IP guidelines say its audio
//     may not be copied or reproduced and that using its rights with AI needs an
//     express licence, so transcription is OFF by default, must be switched on
//     by an operator who has read that notice, and the recordings themselves are
//     never relayed through this server — only the text we produce, with a link
//     back to the F1-hosted recording.
//   * OpenF1 says radio coverage has fallen sharply since 2026 and most events
//     publish none, so an empty panel is a normal state, not a failure.

const crypto = require('node:crypto');
const store = require('./store');
const openf1 = require('./openf1');
const livesignal = require('./livesignal');
const sessionstate = require('./sessionstate');

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 30 * 1000;
// Calls land during the session and the panel should show them within seconds.
const LIVE_TTL_MS = envInt('APEX_RADIO_LIVE_TTL_MS', 10 * 1000);
const TRANSCRIPT_MAX = 40;
const RIGHTS_NOTICE = 'Recordings are Formula 1 copyright. Transcribing them for anything public may need a licence from F1; check before you publish.';

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
}

const cache = { value: null, until: 0, live: null };
const state = { inflight: null };

// OpenF1 repeats the type inside the name ("Race" + "Race"), so collapse it.
function sessionLabel(name, type) {
  const n = String(name || '').trim();
  const t = String(type || '').trim();
  if (!n) return t;
  if (!t || n.toLowerCase() === t.toLowerCase() || n.toLowerCase().startsWith(t.toLowerCase())) return n;
  return `${n} ${t}`;
}

function hashKey(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
}

const api = (path) => openf1.api(path);

function storedTranscripts(db) {
  return db.radioTranscripts && typeof db.radioTranscripts === 'object' ? db.radioTranscripts : {};
}

function radioEnabled(db) {
  return Boolean(db.config && db.config.radio && db.config.radio.enabled);
}

function radioModel(db) {
  const configured = db.config && db.config.radio && db.config.radio.model;
  return typeof configured === 'string' && configured ? configured : DEFAULT_MODEL;
}

// Radio rows are keyed by recording_url; names come from the driver list.
async function collect(passed) {
  const state = passed || (await sessionstate.getSessionState());
  if (state.live) {
    const live = livesignal.snapshot();
    if (live && live.radio.length) {
      return {
        live: true,
        source: 'F1 live timing \u00b7 during the session',
        session: {
          key: live.session.sessionKey,
          name: live.session.sessionName,
          type: live.session.sessionType,
          circuit: live.session.circuit,
          dateStart: live.session.dateStart
        },
        calls: live.radio
      };
    }
  }
  const sessions = await api('/sessions?session_key=latest');
  if (!sessions.length) return { live: false, source: 'OpenF1', session: null, calls: [] };
  const session = sessions[0];
  const [recordings, drivers] = await Promise.all([
    api(`/team_radio?session_key=${session.session_key}`),
    api(`/drivers?session_key=${session.session_key}`)
  ]);
  const byNumber = new Map(drivers.map((d) => [Number(d.driver_number), d]));
  const calls = recordings
    .filter((r) => r.recording_url)
    .map((r) => {
      const driver = byNumber.get(Number(r.driver_number)) || {};
      return {
        id: hashKey(r.recording_url),
        url: r.recording_url,
        at: r.date || '',
        driverNumber: Number(r.driver_number),
        code: driver.name_acronym || String(r.driver_number),
        name: driver.full_name || '',
        team: driver.team_name || '',
        teamColour: driver.team_colour ? `#${driver.team_colour}` : ''
      };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    live: false,
    source: 'OpenF1',
    session: {
      key: session.session_key,
      name: sessionLabel(session.session_name, session.session_type),
      type: session.session_type || '',
      circuit: session.circuit_short_name || '',
      dateStart: session.date_start || ''
    },
    calls
  };
}

async function getRadio() {
  const now = Date.now();
  // The panel changes character the moment a session goes on air (recordings of
  // the last one become calls from this one), so a cached reading is only reused
  // while the site's live state is the same as it was for that reading.
  const sessionState = await sessionstate.getSessionState();
  if (cache.value && cache.until > now && cache.live === Boolean(sessionState.live)) return cache.value;
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const db = store.getDoc();
      const { session, calls, live, source } = await collect(sessionState);
      const transcripts = storedTranscripts(db);
      // A transcript of nothing but punctuation means the clip held no speech,
      // so it is reported as silent rather than as a useless one-character line
      // (this also cleans up anything stored before the model was checked).
      const spoke = (entry) => Boolean(entry && /[a-z0-9]/i.test(String(entry.text || '')));
      const items = calls.slice(0, 12).map((call) => {
        const found = transcripts[call.id];
        return {
          ...call,
          transcript: spoke(found) ? found.text : null,
          transcribedAt: found ? found.at : null,
          status: found ? (spoke(found) ? 'transcribed' : 'silent') : (radioEnabled(db) ? 'pending' : 'disabled')
        };
      });
      // These counts cover the whole session, not just the dozen calls the panel
      // shows, so a client keeping the queue moving doesn't stop early.
      const stored = calls.map((call) => transcripts[call.id]);
      const audible = stored.filter((entry) => spoke(entry)).length;
      const payload = {
        ok: true,
        enabled: radioEnabled(db),
        model: radioModel(db),
        live: Boolean(live),
        source: source || 'OpenF1',
        session,
        available: calls.length,
        transcribed: audible,
        silent: stored.filter((entry) => entry && !spoke(entry)).length,
        pending: calls.length - audible - stored.filter((entry) => entry && !spoke(entry)).length,
        showing: items.length,
        items,
        notice: RIGHTS_NOTICE,
        updatedAt: new Date().toISOString()
      };
      cache.value = payload;
      cache.live = Boolean(live);
      cache.until = Date.now() + (live ? LIVE_TTL_MS : CACHE_TTL_MS);
      return payload;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

async function fetchAudio(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'https:') throw new Error('Only https audio addresses can be transcribed.');
  const res = await fetch(parsed.href, { headers: { 'User-Agent': 'APEXRadio/1.0', Accept: 'audio/*' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`The recording host returned ${res.status}.`);
  const type = String(res.headers.get('content-type') || '');
  if (type && !/^audio\/|octet-stream|mpeg/i.test(type)) throw new Error(`That address is not audio (${type}).`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > MAX_AUDIO_BYTES) throw new Error('That recording is too large to transcribe.');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('That recording is too large to transcribe.');
  if (!buffer.length) throw new Error('The recording came back empty.');
  return buffer;
}

// One transcription: fetch the audio, hand it to Whisper, return the text.
async function transcribe(url, options = {}) {
  const { KEYS } = require('./config');
  if (!KEYS.groq) throw new Error('No Groq API key is configured, so transcription is unavailable.');
  const db = store.getDoc();
  const model = options.model || radioModel(db);
  const buffer = await fetchAudio(url);
  const extension = /\.(\w{2,4})($|\?)/.exec(String(url));
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), `radio.${extension ? extension[1] : 'mp3'}`);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('prompt', 'Formula 1 team radio between a driver and the pit wall.');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEYS.groq}` },
    body: form,
    signal: AbortSignal.timeout(60000)
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 160)}`);
  let text = '';
  try { text = String(JSON.parse(body).text || '').trim(); } catch { text = body.trim(); }
  if (!text) throw new Error('The model returned no transcript for that recording.');
  // A clip of engine noise and pit-wall chatter comes back as punctuation only
  // ("." or "..."); keeping that as a transcript would put a useless line in the
  // panel, so it is recorded as "no speech" and never re-billed.
  const spoken = /[a-z0-9]/i.test(text);
  return { text: spoken ? text : '', model, bytes: buffer.length, silent: !spoken };
}

async function remember(call, result) {
  const db = store.getDoc();
  db.radioTranscripts = storedTranscripts(db);    db.radioTranscripts[call.id] = {
      url: call.url,
      text: result.text,
      silent: Boolean(result.silent),
      model: result.model,
      driver: call.code,
      at: new Date().toISOString()
    };
  const keys = Object.keys(db.radioTranscripts).sort((a, b) => Date.parse(db.radioTranscripts[a].at) - Date.parse(db.radioTranscripts[b].at));
  for (const key of keys.slice(0, Math.max(0, keys.length - TRANSCRIPT_MAX))) delete db.radioTranscripts[key];
  await store.save();
  cache.until = 0;
}

// Transcribe the newest calls that have no transcript yet.
async function transcribePending(limit = 2) {
  const db = store.getDoc();
  if (!radioEnabled(db)) throw new Error('Team radio transcription is switched off.');
  const { calls } = await collect();
  const transcripts = storedTranscripts(db);
  const pending = calls.filter((call) => !transcripts[call.id]).slice(0, Math.max(1, Math.min(5, limit)));
  if (!pending.length) return { done: 0, failed: 0, total: calls.length, message: calls.length ? 'Every recent call already has a transcript.' : 'This session has no radio recordings.' };
  const results = [];
  for (const call of pending) {
    try {
      const result = await transcribe(call.url);
      await remember(call, result);
      results.push({ id: call.id, code: call.code, ok: true, text: result.text });
    } catch (error) {
      results.push({ id: call.id, code: call.code, ok: false, error: error.message });
    }
  }
  return { done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: calls.length, results };
}

// One AI call at a time, paced: the live page asks for the next call, and every
// visitor asking at once still costs exactly one whisper request per cooldown.
const run = { inflight: null, lastStarted: 0 };
const MIN_GAP_MS = envInt('RADIO_TRANSCRIBE_GAP_MS', 6000);

function enabled() {
  return radioEnabled(store.getDoc());
}

function busy() {
  return Boolean(run.inflight);
}

function cooldownLeft() {
  if (!run.lastStarted) return 0;
  return Math.max(0, MIN_GAP_MS - (Date.now() - run.lastStarted));
}

// Transcribe the newest call that has no transcript yet.
async function transcribeNext() {
  if (!enabled()) return { done: 0, reason: 'off', message: 'Team radio transcription is switched off.' };
  if (run.inflight) return { done: 0, reason: 'busy', message: 'Another call is being transcribed.' };
  const wait = cooldownLeft();
  if (wait > 0) return { done: 0, reason: 'cooldown', message: `Next transcription in ${Math.ceil(wait / 1000)}s.` };
  run.inflight = (async () => {
    const db = store.getDoc();
    const { calls } = await collect();
    const transcripts = storedTranscripts(db);
    const pending = calls.filter((call) => !transcripts[call.id]);
    if (!pending.length) {
      return calls.length
        ? { done: 0, reason: 'complete', message: 'Every recent call already has a transcript.', remaining: 0 }
        : { done: 0, reason: 'empty', message: 'This session has no radio recordings yet.', remaining: 0 };
    }
    const call = pending[0];
    run.lastStarted = Date.now();
    const result = await transcribe(call.url);
    await remember(call, result);
    return { done: 1, code: call.code, name: call.name, text: result.text, silent: Boolean(result.silent), model: result.model, remaining: pending.length - 1 };
  })().finally(() => { run.inflight = null; });
  try {
    return await run.inflight;
  } catch (error) {
    run.lastStarted = Date.now();
    return { done: 0, reason: 'failed', message: error.message };
  }
}

module.exports = { getRadio, transcribe, transcribePending, transcribeNext, enabled, busy, cooldownLeft, RIGHTS_NOTICE, DEFAULT_MODEL };
