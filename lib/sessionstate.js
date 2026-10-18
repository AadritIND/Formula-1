// When is the site live?
//
// One answer, used by everything that claims to be live: the timing tower, the
// team radio panel and the page's live/countdown gate. A session is "on air"
// when it is one of the broadcast sessions (race, sprint, the qualifying
// sessions and free practice) AND we are inside its window.
//
// Two sources of truth, in order:
//
//   1. The real-time feed, when it is connected to the same session. F1's live
//      timing says "Started"/"Finished" for itself, and that beats any timetable:
//      a race that runs long keeps us live, and a session that ends early stops
//      us the moment the flag drops.
//   2. The published schedule, otherwise. The window is opened a few minutes
//      early and held open for a grace period after the scheduled end, because
//      sessions routinely start late and run over (Singapore's race was
//      scheduled to finish at 14:00 and finished at 13:45).
//
// Outside a window nothing is polled at all, so an idle week costs no requests
// and no connections.

const providers = require('./providers');

const LEAD_MS = envInt('APEX_LIVE_LEAD_MS', 5 * 60 * 1000);
const GRACE_MS = envInt('APEX_LIVE_GRACE_MS', 20 * 60 * 1000);
const TTL_IDLE_MS = envInt('APEX_STATE_TTL_MS', 5 * 60 * 1000);
// While a session is on, the answer can change at any second (the feed says the
// flag has dropped), so it is worked out often. Recomputing is cheap: the
// schedule behind it is cached for ten minutes either way.
const TTL_LIVE_MS = envInt('APEX_STATE_LIVE_TTL_MS', 5 * 1000);

// The sessions F1 broadcasts with a timing feed. Anything else (testing, "Day
// 2" shakedowns) is never live here. Drop a value to stop the site going live
// for that session: APEX_LIVE_KINDS=sprint,race,free-practice
// The feed may only speak for a session that started recently. A connection that
// is still holding an old session and insisting it is running must not keep the
// site live for days.
const FEED_MAX_AGE_MS = envInt('APEX_LIVE_FEED_MAX_AGE_MS', 4 * 60 * 60 * 1000);
// How long the feed's last reading counts as evidence once it goes quiet.
const EVIDENCE_MAX_AGE_MS = envInt('APEX_STATE_FEED_EVIDENCE_MS', 10 * 60 * 1000);

const ALL_KINDS = ['free-practice', 'sprint-qualifying', 'qualifying', 'sprint', 'race'];
const LIVE_KINDS = new Set(
  String(process.env.APEX_LIVE_KINDS || ALL_KINDS.join(','))
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
}

// What the timetable calls this session, in the site's own vocabulary.
function kindOf(session) {
  const name = String(session.name || '').trim().toLowerCase();
  const type = String(session.type || '').trim().toLowerCase();
  if (type === 'race' && name.includes('sprint')) return 'sprint';
  if (type === 'race') return 'race';
  if (type === 'qualifying' && name.includes('sprint')) return 'sprint-qualifying';
  if (type === 'qualifying') return 'qualifying';
  if (type === 'practice' && /practice\s*[1-9]/.test(name)) return 'free-practice';
  return null;
}

function broadcast(session) {
  const kind = kindOf(session);
  return kind && LIVE_KINDS.has(kind) ? kind : null;
}

// F1's own live-timing feed, when it is running. Set by the handler; returns
// null when the feed is idle.
let feed = null;

function setFeed(probe) {
  feed = typeof probe === 'function' ? probe : null;
}

const state = { value: null, until: 0, inflight: null };

const ms = (value) => {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
};

function describe(session, kind, now) {
  if (!session) return null;
  const start = ms(session.startsAt);
  const end = ms(session.endsAt);
  return {
    id: session.id,
    kind,
    name: session.name || '',
    type: session.type || '',
    event: session.event || '',
    country: session.country || '',
    location: session.location || '',
    circuit: session.circuit || '',
    offset: session.offset || '00:00:00',
    startsAt: session.startsAt || null,
    endsAt: session.endsAt || null,
    localStart: session.localStart || null,
    inWindow: start !== null && end !== null && now >= start && now <= end,
    secondsToStart: start === null ? null : Math.round((start - now) / 1000),
    secondsToEnd: end === null ? null : Math.round((end - now) / 1000)
  };
}

// The real-time feed's own verdict on the session it is attached to.
//
// This deliberately does not require the connection to be open: a session is
// dropped *because* the feed said it had finished, and if that answer were only
// trusted while connected, the timetable's still-open window would light the
// site back up the moment we disconnected. What matters is that the feed has
// actually sent something, and that the reading is recent enough to mean
// something.
function feedVerdict(now) {
  if (!feed) return null;
  let value = null;
  try { value = feed(); } catch { return null; }
  if (!value || !value.frames) return null;
  const age = Number.isFinite(value.ageSeconds) ? value.ageSeconds * 1000 : null;
  if (age !== null && age > EVIDENCE_MAX_AGE_MS) return null;
  const started = String(value.started || '').toLowerCase();
  const status = String(value.status || '').toLowerCase();
  const archived = String(value.archiveStatus || '').toLowerCase();
  if (started === 'finished' || started === 'aborted' || archived === 'complete' || archived === 'archived') return 'over';
  if (started === 'started' || status === 'started' || status === 'ends') return 'running';
  return null;
}

async function compute() {
  const now = Date.now();
  const { sessions, source, errors } = await providers.getSessions();
  const usable = (sessions || [])
    .filter((s) => s && !s.cancelled && ms(s.startsAt))
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));

  const windows = usable
    .map((s) => ({ session: s, kind: broadcast(s), start: ms(s.startsAt), end: ms(s.endsAt) }))
    .filter((entry) => entry.kind);
  const open = windows.filter((e) => now >= e.start - LEAD_MS && (e.end === null || now <= e.end + GRACE_MS));
  const candidate = open.at(-1) || null;
  const next = windows.find((e) => e.start > now) || null;
  const last = windows.filter((e) => e.end !== null && e.end < now).at(-1) || null;

  const verdict = feedVerdict(now);
  const feedSession = safeFeed();
  const feedStart = feedSession ? ms(feedSession.startsAt) : null;
  // The feed's verdict only speaks for the session it is attached to. While it
  // is still showing the previous round (it streams that until the new session
  // opens), its "finished" must not cancel a session the timetable says is on.
  const sameSession = Boolean(feedSession && candidate && String(feedSession.id) === String(candidate.session.id));
  // A session we have watched begin recently is fair evidence even when the
  // timetable does not list it (a schedule that lags behind the lights).
  const feedFresh = feedStart !== null && now >= feedStart - LEAD_MS && now - feedStart < FEED_MAX_AGE_MS;
  const trustRunning = verdict === 'running' && (sameSession || feedFresh);
  const trustOver = verdict === 'over' && (sameSession || !candidate);

  let live = false;
  let proof = 'schedule';
  let session = candidate ? candidate.session : null;
  let kind = candidate ? candidate.kind : null;

  if (trustRunning) {
    // The feed is authoritative: a session is on. If the timetable doesn't list
    // it, the feed's own session is what the page shows.
    live = true;
    proof = 'feed';
    if (!session && feedSession) {
      session = feedSession;
      kind = feedSession.kind || null;
    }
  } else if (trustOver) {
    live = false;
    proof = 'feed';
    session = candidate ? candidate.session : session;
    kind = candidate ? candidate.kind : kind;
  } else if (candidate) {
    // Inside the window on the timetable, and the feed has not contradicted it.
    live = true;
    proof = 'schedule';
  }

  // Not live: show whichever session just ran, so the tower below the countdown
  // is always the most recent thing that actually happened.
  const shown = live ? session : (candidate ? candidate.session : null) || (last ? last.session : null);
  const shownKind = live ? kind : (candidate ? candidate.kind : (last ? last.kind : null));

  // How long this answer can stand. It is capped by the moment the answer could
  // change — the next session's window opening (a few minutes before the lights)
  // — so the page goes live when the session does, not when a cache expires.
  let ttl = live ? TTL_LIVE_MS : TTL_IDLE_MS;
  if (next) {
    const opensAt = next.start - LEAD_MS;
    if (opensAt > now) ttl = Math.min(ttl, Math.max(2000, opensAt - now + 1000));
  }

  return {
    live,
    onAir: live,
    proof,
    kind: shownKind,
    kinds: ALL_KINDS.filter((k) => LIVE_KINDS.has(k)),
    source,
    scheduleErrors: errors || [],
    session: describe(shown, shownKind, now),
    liveSession: live ? describe(session, kind, now) : null,
    nextSession: describe(next ? next.session : null, next ? next.kind : null, now),
    lastSession: describe(last ? last.session : null, last ? last.kind : null, now),
    window: {
      leadMs: LEAD_MS,
      graceMs: GRACE_MS
    },
    updatedAt: new Date().toISOString(),
    refreshAt: new Date(now + ttl).toISOString(),
    nextChangeAt: new Date(now + ttl).toISOString(),
    pollMs: ttl
  };
}

function safeFeed() {
  try {
    const value = feed();
    if (!value || !value.sessionKey) return null;
    const name = String(value.sessionName || '').trim();
    const type = String(value.sessionType || '').trim();
    const mapped = {
      id: value.sessionKey,
      name,
      type,
      event: value.meetingName || '',
      circuit: value.circuit || '',
      country: value.country || '',
      startsAt: value.startsAt || null,
      endsAt: value.endsAt || null,
      offset: value.gmtOffset || '00:00:00'
    };
    return { ...mapped, kind: kindOf(mapped) };
  } catch {
    return null;
  }
}

async function getSessionState() {
  const now = Date.now();
  if (state.value && state.until > now) return state.value;
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const value = await compute();
      const ttl = Date.parse(value.refreshAt) - Date.now();
      state.value = value;
      state.until = Date.now() + Math.max(2000, ttl);
      return value;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

module.exports = { getSessionState, setFeed, kindOf, LIVE_KINDS, ALL_KINDS, LEAD_MS, GRACE_MS };
