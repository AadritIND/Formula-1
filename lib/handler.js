// Shared request handler used by both the local Node server and the Vercel
// serverless function. Keeps every page and API on the same origin.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { PUBLIC_DIR, ADMIN_PASSWORD, SESSION_SECRET, SESSION_TTL_MS, NODE_ENV } = require('./config');
const store = require('./store');
const providers = require('./providers');
const { CIRCUITS, getCircuitProfile } = require('../data/circuitsData');
const { DRIVERS, TEAMS, getDriver, getTeamLogo } = require('../data/paddockData');
const { getCircuitAIBriefing, askRaceEngineer, aiHealth } = require('./ai');
const news = require('./news');
const livetiming = require('./livetiming');
const radio = require('./radio');
const operators = require('./operators');
const sessionstate = require('./sessionstate');
const livesignal = require('./livesignal');

// The session-state module decides when the site is on air; the real-time feed
// is what lets it know a session has actually started or finished rather than
// trusting the timetable.
sessionstate.setFeed(() => livesignal.verdict());

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

const PAGE_ALIASES = {
  '/admin': '/admin.html', '/live': '/live.html', '/timing': '/timing.html', '/standings': '/standings.html',
  '/calendar': '/calendar.html', '/news-garage': '/news-garage.html', '/fan-zone': '/fan-zone.html', '/reaction': '/fan-zone.html',
  '/privacy': '/privacy.html', '/terms': '/terms.html'
};

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ENROLMENT_TTL_MS = 30 * 60 * 1000;

// Why a second-factor attempt was refused, in words an operator can act on.
function codeProblem(reason) {
  if (reason === 'replay') return 'That code was already used. Wait for the next one.';
  if (reason === 'format') return 'Enter the 6-digit code, or one of your recovery codes.';
  if (reason === 'not-enrolled') return 'This account has no authenticator enrolled yet.';
  return 'That code did not match. Check the clock on your authenticator app.';
}

// --- Live chat --------------------------------------------------------------
// The chat is a window onto the current broadcast rather than a permanent room:
// posting is refused unless an operator has the session marked live, and the log
// is capped and expires so the store stays small between race weekends.

const CHAT_MAX = 200;
const CHAT_TTL = 12 * 60 * 60 * 1000;
const CHAT_GAP = 4000;
const chatPosts = new Map();

// Operator slow mode: the gap between two messages from one visitor. The default
// gap is the floor, so slow mode can only ever make the room calmer.
const CHAT_SLOW_CHOICES = [0, 5, 15, 30];

function chatGapMs(db) {
  const seconds = Number(db?.config?.chatSlowSeconds) || 0;
  return Math.max(CHAT_GAP, seconds * 1000);
}

// --- Announcement banner + operator audit trail ------------------------------

const BANNER_MAX = 160;
const AUDIT_MAX = 200;

// The banner is plain text by design: it is shown on every page, so markup is
// stripped at the edge rather than escaped later on each of them.
function cleanBanner(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = String(source.text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BANNER_MAX);
  return { enabled: Boolean(source.enabled) && Boolean(text), tone: source.tone === 'alert' ? 'alert' : 'info', text };
}

function recordAudit(db, action, detail, actor = 'server') {
  db.audit = Array.isArray(db.audit) ? db.audit : [];
  db.audit.push({
    at: new Date().toISOString(),
    action: String(action).slice(0, 40),
    detail: String(detail || '').slice(0, 160),
    actor: String(actor || 'server').slice(0, 40)
  });
  if (db.audit.length > AUDIT_MAX) db.audit = db.audit.slice(-AUDIT_MAX);
}

// --- Chat emoji reactions ---------------------------------------------------
// Viewers can tap a reaction on an existing line without posting. Counts live
// in the store alongside the chat (so they ride the same save/prune path and
// survive restarts); the "have I already tapped this?" ledger stays in memory
// on the same lifecycle as the chat's own IP rate map, so no per-viewer data is
// ever written to disk.

const REACT_SET = ['🔥', '❤️', '😂', '😮', '🏁'];
const REACT_WINDOW = 10 * 1000;
const REACT_MAX = 24; // taps per window, per IP
const REACT_LEDGER_MAX = 40000;
const reactTaps = new Map(); // ip -> tap timestamps inside the window
const reactLedger = new Map(); // `${uid} ${id} ${emoji}` -> expiry

function cleanLine(value, max) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/(.)\1{5,}/g, '$1$1$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// The paddock chat follows the session, not the stream: it is open while race
// control has a broadcast session on air (the same answer the timing tower and
// the radio panel use), and locked the rest of the week. An operator can still
// shut it early by marking the session complete.
async function chatOpen() {
  const db = store.getDoc();
  if (db.config?.status === 'complete') return false;
  try {
    return Boolean((await sessionstate.getSessionState()).live);
  } catch {
    return false;
  }
}

function pruneChat(db) {
  const cutoff = Date.now() - CHAT_TTL;
  db.chat = (db.chat || []).filter((m) => Date.parse(m.at) >= cutoff).slice(-CHAT_MAX);
  return db.chat;
}

// Reaction counts only make sense while their line exists: expiring a message
// (or an operator deleting one) drops its counts on the next read.
function pruneReactions(db) {
  const live = new Set((db.chat || []).map((m) => m.id));
  let changed = false;
  for (const key of Object.keys(db.chatReactions || {})) {
    if (!live.has(Number(key))) { delete db.chatReactions[key]; changed = true; }
  }
  return changed;
}

function reactionAllowed(ip) {
  const now = Date.now();
  const taps = (reactTaps.get(ip) || []).filter((t) => now - t < REACT_WINDOW);
  if (taps.length >= REACT_MAX) { reactTaps.set(ip, taps); return false; }
  taps.push(now);
  reactTaps.set(ip, taps);
  return true;
}

// Returns true when this tap *removed* an existing reaction (toggle semantics).
function ledgerTake(uid, id, emoji) {
  const key = `${uid} ${id} ${emoji}`;
  if (reactLedger.has(key)) { reactLedger.delete(key); return true; }
  if (reactLedger.size >= REACT_LEDGER_MAX) {
    const now = Date.now();
    for (const [k, expires] of reactLedger) { if (expires <= now) reactLedger.delete(k); }
    // Still full of live entries: drop the oldest quarter (insertion order).
    let drop = Math.ceil(REACT_LEDGER_MAX / 4);
    for (const k of reactLedger.keys()) { reactLedger.delete(k); if (--drop <= 0) break; }
  }
  reactLedger.set(key, Date.now() + CHAT_TTL);
  return false;
}
let backendHealthCache = { value: null, until: 0 };

// --- Admin sessions ---------------------------------------------------------
// Tokens are HMAC-signed so they survive serverless cold starts and scale across
// instances without shared memory. A version 2 token carries the operator id,
// their role, whether a second factor was used, and the account's token version
// — so a role change, a disable, a password change or a two-factor reset kills
// every session that account had open, with no session table to keep.

const SESSION_VERSION = '2';
const BREAK_GLASS_TTL_MS = 60 * 60 * 1000; // the server password signs in for an hour

function signSession(session) {
  const payload = [
    SESSION_VERSION,
    session.sub,
    session.role,
    session.mfa ? '1' : '0',
    String(session.ver),
    String(session.expires),
    crypto.randomBytes(6).toString('hex')
  ].join('.');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return null; }
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [version, sub, , mfa, ver, expires] = payload.split('.');
  if (version !== SESSION_VERSION) return null;
  if (!Number.isFinite(Number(expires)) || Number(expires) < Date.now()) return null;
  return { sub, mfa: mfa === '1', ver: Number(ver), expires: Number(expires) };
}

// Short-lived token proving the password step succeeded, so the second factor is
// asked for in a separate request and a stolen cookie is still not enough.
function signChallenge(kind, sub, ttlMs) {
  const payload = [kind, sub, String(Date.now() + ttlMs), crypto.randomBytes(8).toString('hex')].join('.');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`challenge:${payload}`).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function readChallenge(token, kind) {
  if (!token || typeof token !== 'string') return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return null; }
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`challenge:${payload}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [type, sub, expires] = payload.split('.');
  if (type !== kind) return null;
  if (!Number.isFinite(Number(expires)) || Number(expires) < Date.now()) return null;
  return { sub, expires: Number(expires) };
}

// Resolves a request to the operator behind it, or null when the session is
// absent, expired, revoked, disabled or missing its second factor.
function sessionFor(req) {
  const claims = verifySessionToken(cookies(req).apex_admin);
  if (!claims) return null;
  if (claims.sub === 'break-glass') {
    return {
      actor: 'server password',
      role: 'owner',
      roleLabel: 'OWNER',
      permissions: operators.ROLES.owner.permissions,
      breakGlass: true,
      mfa: false,
      account: null
    };
  }
  const record = operators.findAccount(store.getDoc(), claims.sub);
  if (!record || record.disabled) return null;
  if (Number(record.ver || 1) !== claims.ver) return null;      // role, password or 2FA changed
  if (!record.totp || !record.totp.confirmedAt) return null;    // second factor withdrawn
  return {
    actor: record.name,
    role: record.role,
    roleLabel: (operators.ROLES[record.role] || {}).label || record.role,
    permissions: (operators.ROLES[record.role] || {}).permissions || [],
    breakGlass: false,
    mfa: claims.mfa,
    account: record
  };
}

// Which permission an admin route needs. Anything not listed fails closed, so a
// route added later is never accidentally public to every operator.
function permissionFor(method, pathname) {
  if (pathname === '/api/admin/config') return 'config';
  if (pathname.startsWith('/api/admin/chat')) return 'chat';
  if (pathname === '/api/admin/news/refresh') return 'news';
  if (pathname === '/api/admin/radio/transcribe') return 'radio';
  if (pathname === '/api/admin/diagnostics') return 'diagnostics';
  if (pathname === '/api/admin/export') return 'export';
  if (pathname === '/api/admin/newsletter') return 'export';
  if (pathname === '/api/admin/audit') return method === 'DELETE' ? 'audit:clear' : 'audit';
  if (pathname === '/api/admin/operators' || pathname.startsWith('/api/admin/operators/')) return 'operators';
  if (pathname.startsWith('/api/admin/invites')) return 'operators';
  if (pathname.startsWith('/api/admin/me')) return null;  // any signed-in operator
  return 'unmapped';
}

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('=');
    return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
  }));
}

function authorized(req) {
  return Boolean(sessionFor(req));
}

function adminConfigured() {
  if (ADMIN_PASSWORD) return true;
  const db = store.getDoc();
  return Boolean(db.admin?.salt) || operators.accounts(db).length > 0;
}

// The server password (and any credential created before accounts existed) signs
// in as an owner without a second factor. It is a break-glass credential, not a
// shared password: it lives in the environment, sessions last an hour, and the
// audit log marks every action taken with it.
function breakGlassMatch(password) {
  const submitted = String(password || '');
  if (ADMIN_PASSWORD) {
    const provided = crypto.createHash('sha256').update(submitted).digest();
    const expected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    return crypto.timingSafeEqual(provided, expected);
  }
  const legacy = store.getDoc().admin;
  if (legacy?.salt && legacy?.hash) return operators.verifyPassword(legacy, submitted);
  return false;
}

async function openBreakGlassSession(res, db, note) {
  recordAudit(db, 'SIGN IN', note, 'server password');
  await store.save();
  const token = signSession({ sub: 'break-glass', role: 'owner', mfa: false, ver: 0, expires: Date.now() + BREAK_GLASS_TTL_MS });
  return json(res, 200, { ok: true, breakGlass: true }, { 'Set-Cookie': cookieHeader(token, BREAK_GLASS_TTL_MS / 1000) });
}

async function openOperatorSession(res, db, record, via) {
  record.lastLoginAt = new Date().toISOString();
  recordAudit(db, 'SIGN IN', `two-factor ${via}`, record.name);
  await store.save();
  const token = signSession({ sub: record.id, role: record.role, mfa: true, ver: Number(record.ver || 1), expires: Date.now() + SESSION_TTL_MS });
  return json(res, 200, { ok: true, account: operators.publicAccount(record) }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
}

function localBootstrapRequest(req) {
  const ip = req.socket?.remoteAddress || '';
  const host = (req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) && ['localhost', '127.0.0.1', '::1'].includes(host);
}

function readBody(req, limit = 15000) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > limit) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// The operator can paste either the provider's whole <iframe …> snippet or a
// bare embed URL. Only the https address inside it is kept: the snippet's own
// width, height and scrolling attributes would fight the page's responsive
// frame, and a non-https address could not be framed by this site anyway.
const EMBED_HOST_BLOCKED = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[^.]*\.local)$/i;

function normaliseEmbed(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const snippet = raw.match(/<iframe[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  const candidate = (snippet ? snippet[1] : raw).trim();
  let url;
  try { url = new URL(candidate); } catch { return ''; }
  if (url.protocol !== 'https:') return '';
  if (!url.hostname.includes('.') || EMBED_HOST_BLOCKED.test(url.hostname)) return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  // Watch pages are rewritten to the embed form the providers actually serve.
  const video = url.searchParams.get('v');
  if (host === 'youtube.com' && url.pathname === '/watch' && video) return `https://www.youtube.com/embed/${encodeURIComponent(video)}`;
  if (host === 'youtu.be' && url.pathname.length > 1) return `https://www.youtube.com/embed/${encodeURIComponent(url.pathname.slice(1))}`;
  if (host === 'vimeo.com' && /^\/\d+/.test(url.pathname)) return `https://player.vimeo.com/video/${url.pathname.split('/')[1]}`;
  return url.href;
}

function cookieHeader(token, maxAge) {
  return `apex_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${NODE_ENV === 'production' ? '; Secure' : ''}`;
}

// --- Live telemetry simulator ----------------------------------------------

function generateLiveTelemetrySnapshot() {
  const driverCodes = ['VER', 'ANT', 'NOR', 'LEC', 'HAM', 'RUS', 'PIA', 'HAD', 'SAI', 'ALO', 'ALB', 'GAS', 'LAW', 'HUL', 'OCO', 'BEA', 'STR', 'COL', 'LIN', 'BOR'];
  const compounds = ['SOFT', 'MEDIUM', 'HARD'];
  return {
    source: 'APEX Live Telemetry Hub',
    timestamp: new Date().toISOString(),
    trackStatus: 'ALL CLEAR · GREEN FLAG',
    trackTemp: '38.4°C', airTemp: '27.1°C', humidity: '54%', windSpeed: '12 km/h NE',
    safetyCar: false, virtualSafetyCar: false, activeAeroMode: 'STRAIGHT MODE AVAILABLE',
    leaderboard: driverCodes.map((code, idx) => {
      const d = getDriver(code) || { name: code, team: 'F1', teamColour: '#ed1c24' };
      const gapSec = idx === 0 ? 'LEADER' : `+${(idx * 1.84 + Math.sin(idx) * 0.4).toFixed(3)}s`;
      const interval = idx === 0 ? '—' : `+${(1.2 + Math.cos(idx) * 0.3).toFixed(3)}s`;
      const lastLap = `${Math.floor(78 / 60)}:${(18.2 + idx * 0.23 + Math.sin(idx * 3) * 0.15).toFixed(3).padStart(6, '0')}`;
      return {
        position: idx + 1, code, name: d.name, team: d.team, teamColour: d.teamColour,
        headshotUrl: d.photo, teamLogo: getTeamLogo(d.team), gap: gapSec, interval, lastLap,
        s1: (28.4 + Math.sin(idx) * 0.2).toFixed(3), s2: (34.1 + Math.cos(idx) * 0.3).toFixed(3),
        s3: (26.3 + Math.sin(idx * 2) * 0.2).toFixed(3),
        speedTrap: Math.round(338 - idx * 1.8 + Math.sin(idx) * 4),
        compound: compounds[idx % 3], tyreAge: 12 + (idx % 7),
        drsState: idx > 0 ? (idx % 2 === 0 ? 'ACTIVE' : 'AVAILABLE') : 'N/A'
      };
    })
  };
}

async function buildCalendar() {
  const { sessions } = await providers.getSessions();
  const meetings = new Map();
  for (const s of sessions) {
    const key = s.meetingId ?? s.id;
    if (!meetings.has(key)) {
      const profile = getCircuitProfile(s.circuitKey) || getCircuitProfile(s.circuit) || getCircuitProfile(s.event);
      meetings.set(key, {
        meetingId: s.meetingId, round: s.round || meetings.size + 1, name: s.event,
        location: s.location, circuit: profile?.circuit || s.circuit, circuitKey: profile?.key || s.circuitKey,
        circuitSlug: profile?.slug || '', circuitDetailedImage: profile?.detailedImage || '',
        circuitImage: profile?.detailedImage || '', carbonImage: profile?.carbonImage || '',
        circuitLength: profile?.lengthKm || null, turns: profile?.turns || null,
        overtakeZones: profile?.overtakeZones || null, speedTrap: profile?.speedTrap || '',
        detectionZones: profile?.detectionZones || '', sectors: profile?.sectors || [],
        lapRecord: profile?.lapRecord || null, technicalNotes: profile?.technicalNotes || '',
        country: profile?.country || s.country, flag: profile?.flag || '', offset: s.offset,
        startsAt: s.startsAt, endsAt: s.endsAt, sessions: []
      });
    }
    const m = meetings.get(key);
    if (Date.parse(s.startsAt) < Date.parse(m.startsAt)) m.startsAt = s.startsAt;
    if (Date.parse(s.endsAt) > Date.parse(m.endsAt)) m.endsAt = s.endsAt;
    m.sessions.push(s);
  }
  const races = [...meetings.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  await Promise.all(races.map(async (race) => {
    const raceSession = race.sessions.find((s) => providers.isGrandPrixRace(s) && Date.parse(s.endsAt) < Date.now());
    if (raceSession) race.result = await providers.getWeekendResult(raceSession);
  }));
  return races;
}

async function backendHealth() {
  if (backendHealthCache.value && backendHealthCache.until > Date.now()) return backendHealthCache.value;
  const [dataProviders, aiProviders] = await Promise.all([providers.providerHealth(), aiHealth()]);
  const value = {
    ok: true,
    checkedAt: new Date().toISOString(),
    storage: store.info(),
    dataProviders,
    aiProviders
  };
  backendHealthCache = { value, until: Date.now() + 60 * 1000 };
  return value;
}

// --- Rolling snapshot -------------------------------------------------------
// When a live provider answers, refresh the saved copy in the store so the
// last-resort fallback reflects recent real data instead of a stale seed.
// Writes are throttled so a busy site does not hammer the storage backend.

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
let lastSnapshotAt = 0;

async function persistSnapshots(partial) {
  if (Date.now() - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotAt = Date.now();
  try {
    Object.assign(store.getDoc(), partial);
    await store.save();
  } catch { /* snapshot refresh is best effort */ }
}

// --- Request handler --------------------------------------------------------

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // frame-src stays scheme-limited rather than origin-limited: the broadcast
  // embed is operator-chosen, and this site only ever frames that one URL.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https://media.formula1.com https://www.formula1.com https://*.formula1.com https://*.cloudfront.net https://*.ytimg.com https://*.vimeocdn.com; frame-src https:; connect-src 'self' https://api.openf1.org https://api.jolpi.ca https://api.groq.com https://generativelanguage.googleapis.com https://openrouter.ai; media-src 'self' https://livetiming.formula1.com https://*.formula1.com https://*.cloudfront.net; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

  if (req.method === 'GET' && (url.pathname === '/reaction' || url.pathname === '/reaction.html')) {
    res.writeHead(302, { Location: '/fan-zone#lights', 'Cache-Control': 'no-store' });
    return res.end();
  }

  // The Garage page was retired in favour of the News Garage; forward old links
  // instead of dead-ending them. (On Vercel the same redirect lives in vercel.json,
  // because static 404s never reach this handler.)
  if (req.method === 'GET' && (url.pathname === '/garage' || url.pathname === '/garage.html')) {
    res.writeHead(302, { Location: '/news-garage', 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    await store.load();

    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin) {
        try { if (new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-site request denied.' }); }
        catch { return json(res, 403, { error: 'Invalid origin.' }); }
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, adminConfigured: adminConfigured(), storage: store.info() });
    }

    if (req.method === 'GET' && (url.pathname === '/api/health/backends' || url.pathname === '/api/backends')) {
      try { return json(res, 200, await backendHealth()); }
      catch (e) { return json(res, 200, { ok: false, error: e.message, storage: store.info() }); }
    }

    // --- Sign in: the password, then the second factor -----------------------
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      if (!adminConfigured()) return json(res, 409, { error: 'Set an admin password before signing in.' });
      const ipKey = `ip:${req.socket?.remoteAddress || 'unknown'}`;
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const db = store.getDoc();
      const password = String(body.password || '');
      const identity = operators.cleanName(body.account).toLowerCase();

      // No account name means the server password: owner rights for one hour,
      // no second factor, and every action written to the log as break-glass.
      if (!identity) {
        const blocked = operators.throttleCheck(ipKey);
        if (blocked.blocked) return json(res, 429, { error: `Too many sign-in attempts. Try again in ${Math.ceil(blocked.retryInSeconds / 60)} minute(s).` });
        if (!breakGlassMatch(password)) {
          operators.throttleFail(ipKey);
          return json(res, 401, { error: 'That password did not match.' });
        }
        operators.throttleClear(ipKey);
        return await openBreakGlassSession(res, db, 'signed in with the server password');
      }

      const record = operators.findByIdentity(db, identity);
      const accountKey = `account:${record ? record.id : `unknown:${identity}`}`;
      const accountBlocked = operators.throttleCheck(accountKey);
      if (accountBlocked.blocked) return json(res, 429, { error: 'That account is locked for a few minutes after too many attempts.' });
      const ipBlocked = operators.throttleCheck(ipKey);
      if (ipBlocked.blocked) return json(res, 429, { error: `Too many sign-in attempts. Try again in ${Math.ceil(ipBlocked.retryInSeconds / 60)} minute(s).` });

      // A missing account still pays the scrypt cost, so response timing does
      // not reveal which account names exist.
      const passwordOk = operators.verifyPassword(record || operators.DUMMY, password);
      if (!record || !passwordOk) {
        operators.throttleFail(ipKey);
        operators.throttleFail(accountKey);
        recordAudit(db, 'SIGN IN FAILED', `password step for “${identity}”`, 'unauthenticated');
        await store.save();
        return json(res, 401, { error: 'That password did not match.' });
      }
      if (record.disabled) return json(res, 403, { error: 'That account is switched off.' });
      if (!record.totp || !record.totp.confirmedAt) {
        return json(res, 409, { error: 'Finish two-factor setup from your invitation link before signing in.' });
      }
      operators.throttleClear(ipKey);
      return json(res, 200, {
        ok: true,
        mfaRequired: true,
        challenge: signChallenge('mfa', record.id, MFA_CHALLENGE_TTL_MS),
        account: { name: record.name, roleLabel: (operators.ROLES[record.role] || {}).label || record.role },
        via: record.totp && record.totp.confirmedAt ? 'authenticator' : 'invitation'
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login/mfa') {
      let body;
      try { body = await readBody(req, 2000); } catch (e) { return json(res, 400, { error: e.message }); }
      const claims = readChallenge(String(body.challenge || ''), 'mfa');
      if (!claims) return json(res, 400, { error: 'That sign-in attempt timed out. Start again.' });
      const ipKey = `ip:${req.socket?.remoteAddress || 'unknown'}`;
      const accountKey = `account:${claims.sub}`;
      const accountBlocked = operators.throttleCheck(accountKey);
      if (accountBlocked.blocked) return json(res, 429, { error: 'Too many codes tried. Wait a few minutes and start again.' });
      const db = store.getDoc();
      const record = operators.findAccount(db, claims.sub);
      if (!record || record.disabled) return json(res, 403, { error: 'That account is no longer active.' });
      const result = operators.verifySecondFactor(record, body.code);
      if (!result.ok) {
        const state = operators.throttleFail(accountKey);
        operators.throttleFail(ipKey);
        recordAudit(db, 'SIGN IN FAILED', `second factor · ${result.reason}`, record.name);
        await store.save();
        return json(res, 401, { error: codeProblem(result.reason), attemptsLeft: state.remaining });
      }
      operators.throttleClear(accountKey);
      operators.throttleClear(ipKey);
      await store.save();
      return await openOperatorSession(res, db, record, result.via === 'recovery' ? 'recovery code' : 'code');
    }

    // --- First run on this machine -------------------------------------------
    // Creates the first owner account and hands back the authenticator secret;
    // the session only opens once a code from that secret has been confirmed.
    if (req.method === 'POST' && url.pathname === '/api/admin/bootstrap') {
      if (adminConfigured()) return json(res, 409, { error: 'Admin access has already been configured.' });
      if (!localBootstrapRequest(req)) return json(res, 403, { error: 'First-run setup is only available from localhost.' });
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const problem = operators.passwordProblem(body.password);
      if (problem) return json(res, 400, { error: problem });
      const email = operators.cleanEmail(body.email);
      if (email === null) return json(res, 400, { error: 'That email address does not look right.' });
      const db = store.getDoc();
      const record = operators.createAccount(db, {
        name: operators.cleanName(body.name) || 'owner',
        email: email || '',
        role: 'owner',
        password: String(body.password),
        createdBy: 'first-run setup'
      });
      const enrolment = operators.startEnrolment(record);
      recordAudit(db, 'SECURITY', `owner account “${record.name}” created on this server`, record.name);
      await store.save();
      return json(res, 201, {
        ok: true,
        step: 'mfa',
        challenge: signChallenge('enrol', record.id, ENROLMENT_TTL_MS),
        secret: enrolment.secret,
        uri: enrolment.uri,
        account: operators.publicAccount(record)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/bootstrap/mfa') {
      if (!localBootstrapRequest(req)) return json(res, 403, { error: 'First-run setup is only available from localhost.' });
      let body;
      try { body = await readBody(req, 2000); } catch (e) { return json(res, 400, { error: e.message }); }
      const claims = readChallenge(String(body.challenge || ''), 'enrol');
      if (!claims) return json(res, 400, { error: 'That setup attempt timed out. Start again.' });
      const db = store.getDoc();
      const record = operators.findAccount(db, claims.sub);
      if (!record) return json(res, 400, { error: 'That setup attempt is no longer valid.' });
      const result = operators.confirmEnrolment(record, body.code);
      if (!result.ok) return json(res, 400, { error: result.error });
      recordAudit(db, 'SECURITY', `two-factor enrolled for “${record.name}”`, record.name);
      await store.save();
      const token = signSession({ sub: record.id, role: record.role, mfa: true, ver: Number(record.ver || 1), expires: Date.now() + SESSION_TTL_MS });
      return json(res, 201, { ok: true, recoveryCodes: result.recoveryCodes, account: operators.publicAccount(record) }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    // --- Invitations: how an operator joins without anyone sharing a password --
    if (req.method === 'GET' && url.pathname === '/api/admin/invite') {
      const found = operators.findInvite(store.getDoc(), url.searchParams.get('token'));
      if (!found.ok) return json(res, 200, { ok: false, error: found.error });
      const { invite } = found;
      return json(res, 200, {
        ok: true,
        name: invite.name,
        email: invite.email,
        role: invite.role,
        roleLabel: (operators.ROLES[invite.role] || {}).label || invite.role,
        roleBlurb: (operators.ROLES[invite.role] || {}).blurb || '',
        invitedBy: invite.createdBy,
        expiresAt: invite.expiresAt,
        existing: Boolean(invite.accountId),
        passwordMin: operators.PASSWORD_MIN
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/invite/accept') {
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const found = operators.findInvite(store.getDoc(), body.token);
      if (!found.ok) return json(res, 400, { error: found.error });
      const { invite } = found;
      const db = store.getDoc();

      // Step one: choose a password, and receive the authenticator secret.
      if (!body.code) {
        const password = String(body.password || '');
        const problem = operators.passwordProblem(password);
        if (problem) return json(res, 400, { error: problem });
        let record = invite.accountId ? operators.findAccount(db, invite.accountId) : null;
        if (invite.accountId && !record) return json(res, 400, { error: 'That account no longer exists.' });
        if (record) {
          operators.setPassword(record, password);
          if (body.name) record.name = operators.cleanName(body.name) || record.name;
        } else {
          record = operators.createAccount(db, {
            name: invite.name,
            email: invite.email,
            role: invite.role,
            password,
            createdBy: invite.createdBy
          });
          invite.accountId = record.id;
        }
        const enrolment = operators.startEnrolment(record);
        await store.save();
        return json(res, 200, {
          ok: true,
          step: 'mfa',
          challenge: signChallenge('invite', record.id, ENROLMENT_TTL_MS),
          secret: enrolment.secret,
          uri: enrolment.uri,
          account: operators.publicAccount(record)
        });
      }

      // Step two: confirm a code from the authenticator. Only now does the
      // account become usable, so an invitation can never leave a
      // password-only way in.
      const claims = readChallenge(String(body.challenge || ''), 'invite');
      const record = claims ? operators.findAccount(db, claims.sub) : (invite.accountId ? operators.findAccount(db, invite.accountId) : null);
      if (!record || (invite.accountId && record.id !== invite.accountId)) return json(res, 400, { error: 'That invitation is no longer valid.' });
      const result = operators.confirmEnrolment(record, body.code);
      if (!result.ok) return json(res, 400, { error: result.error });
      const reEnrolled = Boolean(invite.reEnrolment);
      operators.closeInvite(db, invite);
      recordAudit(db, 'OPERATORS', `${reEnrolled ? 'two-factor re-enrolled' : 'account activated'} for “${record.name}”`, record.name);
      await store.save();
      const token = signSession({ sub: record.id, role: record.role, mfa: true, ver: Number(record.ver || 1), expires: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { ok: true, recoveryCodes: result.recoveryCodes, account: operators.publicAccount(record) }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/status') {
      const session = sessionFor(req);
      return json(res, 200, {
        authenticated: Boolean(session),
        configured: adminConfigured(),
        canBootstrap: !adminConfigured() && localBootstrapRequest(req),
        account: session ? {
          actor: session.actor,
          role: session.role,
          roleLabel: session.roleLabel,
          permissions: session.permissions,
          breakGlass: session.breakGlass,
          mfa: session.mfa,
          recoveryLeft: session.account ? operators.publicAccount(session.account).mfa.recoveryLeft : null
        } : null
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      const session = sessionFor(req);
      if (session) {
        const db = store.getDoc();
        recordAudit(db, 'SIGN OUT', 'session closed', session.actor);
        await store.save();
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
    }

    // Everything below this line belongs to an operator session, and most of it
    // to one particular role. Routes that are not mapped above fail closed.
    if (url.pathname.startsWith('/api/admin/')) {
      const session = sessionFor(req);
      if (!session) return json(res, 401, { error: 'Sign in to the admin panel.' });
      const needed = permissionFor(req.method, url.pathname);
      if (needed && !session.permissions.includes(needed)) {
        return json(res, 403, { error: `${session.roleLabel} accounts cannot do that.`, permission: needed });
      }
      req.apexOperator = session;
    }

    // Every audit line below carries the operator who caused it.
    const actor = () => (req.apexOperator ? req.apexOperator.actor : 'server');
    const operatorPath = /^\/api\/admin\/operators\/([0-9a-fA-F-]{36})(?:\/(invite|reset-mfa))?$/.exec(url.pathname);
    const invitePath = /^\/api\/admin\/invites\/([0-9a-fA-F-]{36})$/.exec(url.pathname);

    // --- The signed-in operator's own account -------------------------------
    if (req.method === 'GET' && url.pathname === '/api/admin/me') {
      const me = req.apexOperator;
      return json(res, 200, {
        actor: me.actor,
        role: me.role,
        roleLabel: me.roleLabel,
        permissions: me.permissions,
        breakGlass: me.breakGlass,
        account: me.account ? operators.publicAccount(me.account) : null,
        passwordMin: operators.PASSWORD_MIN,
        roles: operators.ROLE_NAMES.map((name) => ({ name, label: operators.ROLES[name].label, blurb: operators.ROLES[name].blurb }))
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/me/password') {
      const me = req.apexOperator;
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      if (me.breakGlass) return json(res, 409, { error: 'The server password is changed in the environment, not here. Create an account for yourself in Operators.' });
      const problem = operators.passwordProblem(body.next);
      if (problem) return json(res, 400, { error: problem });
      if (!operators.verifyPassword(me.account, body.current)) return json(res, 401, { error: 'Your current password did not match.' });
      const db = store.getDoc();
      operators.setPassword(me.account, String(body.next));
      recordAudit(db, 'OPERATORS', 'changed their own password', me.actor);
      await store.save();
      // The old tokens are dead now, so hand this session a fresh one.
      const token = signSession({ sub: me.account.id, role: me.account.role, mfa: true, ver: Number(me.account.ver || 1), expires: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/me/mfa/start') {
      const me = req.apexOperator;
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      if (me.breakGlass) return json(res, 409, { error: 'Create an account for yourself first; the server password has no authenticator.' });
      // Replacing an enrolled authenticator is a security change, so it needs the
      // password again. First-time enrolment is already gated by the password step.
      if (me.account.totp && me.account.totp.confirmedAt && !operators.verifyPassword(me.account, body.password)) {
        return json(res, 401, { error: 'Confirm your password to replace the authenticator.' });
      }
      const db = store.getDoc();
      const enrolment = operators.startEnrolment(me.account);
      recordAudit(db, 'OPERATORS', 'started authenticator enrolment', me.actor);
      await store.save();
      return json(res, 200, { ok: true, secret: enrolment.secret, uri: enrolment.uri, replacing: Boolean(me.account.totp && me.account.totp.confirmedAt) });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/me/mfa/confirm') {
      const me = req.apexOperator;
      let body;
      try { body = await readBody(req, 2000); } catch (e) { return json(res, 400, { error: e.message }); }
      if (me.breakGlass) return json(res, 409, { error: 'The server password has no authenticator to confirm.' });
      const db = store.getDoc();
      const result = operators.confirmEnrolment(me.account, body.code);
      if (!result.ok) return json(res, 400, { error: result.error });
      recordAudit(db, 'OPERATORS', 'authenticator confirmed', me.actor);
      await store.save();
      const token = signSession({ sub: me.account.id, role: me.account.role, mfa: true, ver: Number(me.account.ver || 1), expires: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { ok: true, recoveryCodes: result.recoveryCodes }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/me/mfa/recovery') {
      const me = req.apexOperator;
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      if (me.breakGlass) return json(res, 409, { error: 'The server password has no recovery codes.' });
      if (!operators.verifyPassword(me.account, body.password)) return json(res, 401, { error: 'Confirm your password to reissue recovery codes.' });
      const db = store.getDoc();
      const codes = operators.generateRecoveryCodes(me.account);
      recordAudit(db, 'OPERATORS', 'reissued their recovery codes', me.actor);
      await store.save();
      return json(res, 200, { ok: true, recoveryCodes: codes });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/me/signout-everywhere') {
      const me = req.apexOperator;
      if (me.breakGlass) return json(res, 409, { error: 'Server-password sessions last an hour and cannot be extended.' });
      const db = store.getDoc();
      operators.bumpVersion(me.account);
      recordAudit(db, 'OPERATORS', 'signed out every other session', me.actor);
      await store.save();
      const token = signSession({ sub: me.account.id, role: me.account.role, mfa: true, ver: Number(me.account.ver || 1), expires: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    // --- Operator accounts (owner only) --------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/admin/operators') {
      const db = store.getDoc();
      return json(res, 200, {
        accounts: operators.listAccounts(db),
        invites: operators.listInvites(db),
        roles: operators.ROLE_NAMES.map((name) => ({ name, label: operators.ROLES[name].label, blurb: operators.ROLES[name].blurb, permissions: operators.ROLES[name].permissions })),
        passwordMin: operators.PASSWORD_MIN,
        inviteTtlMinutes: Math.round(operators.INVITE_TTL_MS / 60000),
        you: req.apexOperator.account ? req.apexOperator.account.id : null,
        breakGlass: req.apexOperator.breakGlass
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/operators') {
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const name = operators.cleanName(body.name);
      if (!name) return json(res, 400, { error: 'Give the operator a name to sign in with.' });
      const email = operators.cleanEmail(body.email);
      if (email === null) return json(res, 400, { error: 'That email address does not look right.' });
      const db = store.getDoc();
      if (operators.findByIdentity(db, name) || (email && operators.findByIdentity(db, email))) {
        return json(res, 409, { error: 'Another account already uses that name or address.' });
      }
      const role = operators.ROLE_NAMES.includes(body.role) ? body.role : 'moderator';
      const { invite, path: invitePathValue, expiresAt } = operators.createInvite(db, { name, email, role, createdBy: actor() });
      recordAudit(db, 'OPERATORS', `invitation issued for “${name}” · ${(operators.ROLES[role] || {}).label || role}`, actor());
      await store.save();
      return json(res, 201, { ok: true, invitePath: invitePathValue, expiresAt, inviteId: invite.id, name, role });
    }

    if (operatorPath) {
      const db = store.getDoc();
      const record = operators.findAccount(db, operatorPath[1]);
      if (!record) return json(res, 404, { error: 'No such operator account.' });
      const sub = operatorPath[2];

      // Re-send an invitation: the way back in for someone who never finished,
      // and the way to re-enrol after their authenticator is lost.
      if (req.method === 'POST' && sub === 'invite') {
        const { path: invitePathValue, expiresAt } = operators.createInvite(db, {
          name: record.name, email: record.email, role: record.role, createdBy: actor(), accountId: record.id
        });
        recordAudit(db, 'OPERATORS', `invitation reissued for “${record.name}”`, actor());
        await store.save();
        return json(res, 200, { ok: true, invitePath: invitePathValue, expiresAt });
      }

      // Lost-device reset: the enrolled authenticator is withdrawn, so the
      // account cannot sign in until a new one is enrolled from an invitation.
      if (req.method === 'POST' && sub === 'reset-mfa') {
        record.totp = null;
        record.recovery = [];
        operators.bumpVersion(record);
        const { path: invitePathValue, expiresAt } = operators.createInvite(db, {
          name: record.name, email: record.email, role: record.role, createdBy: actor(), accountId: record.id
        });
        recordAudit(db, 'SECURITY', `authenticator reset for “${record.name}”`, actor());
        await store.save();
        return json(res, 200, { ok: true, invitePath: invitePathValue, expiresAt, account: operators.publicAccount(record) });
      }

      if (req.method === 'PATCH') {
        let body;
        try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
        const notes = [];
        if (body.role !== undefined) {
          if (!operators.ROLE_NAMES.includes(body.role)) return json(res, 400, { error: 'That is not a role this site knows.' });
          if (record.role === 'owner' && body.role !== 'owner' && record.id === (req.apexOperator.account && req.apexOperator.account.id) && operators.ownedTemplates(db) <= 1) {
            return json(res, 400, { error: 'Keep one owner account before stepping down.' });
          }
          if (operators.setRole(record, body.role)) notes.push(`role → ${(operators.ROLES[body.role] || {}).label || body.role}`);
        }
        if (body.disabled !== undefined) {
          const result = operators.setDisabled(db, record, Boolean(body.disabled));
          if (!result.ok) return json(res, 400, { error: result.error });
          notes.push(body.disabled ? 'switched off' : 'switched back on');
        }
        if (!notes.length) return json(res, 200, { ok: true, changed: [], account: operators.publicAccount(record) });
        recordAudit(db, 'OPERATORS', `“${record.name}” ${notes.join(' · ')}`, actor());
        await store.save();
        return json(res, 200, { ok: true, changed: notes, account: operators.publicAccount(record) });
      }

      if (req.method === 'DELETE') {
        if (req.apexOperator.account && req.apexOperator.account.id === record.id) {
          return json(res, 400, { error: 'You cannot remove the account you are signed in with.' });
        }
        const result = operators.removeAccount(db, record);
        if (!result.ok) return json(res, 400, { error: result.error });
        recordAudit(db, 'OPERATORS', `removed “${record.name}”`, actor());
        await store.save();
        return json(res, 200, { ok: true });
      }

      return json(res, 405, { error: 'Unsupported method for that account.' });
    }

    if (invitePath && req.method === 'DELETE') {
      const db = store.getDoc();
      const invite = (Array.isArray(db.invites) ? db.invites : []).find((entry) => entry.id === invitePath[1]);
      if (!invite) return json(res, 404, { error: 'No such invitation.' });
      db.invites = db.invites.filter((entry) => entry.id !== invitePath[1]);
      recordAudit(db, 'OPERATORS', `invitation for “${invite.name}” revoked`, actor());
      await store.save();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/public/config') {
      const db = store.getDoc();
      return json(res, 200, { ...db.config, streamUrl: db.config.status === 'live' ? db.config.streamUrl : '' });
    }

    if (req.method === 'GET' && url.pathname === '/api/news') {
      try {
        const payload = await news.getNews({ force: url.searchParams.get('refresh') === '1' });
        return json(res, 200, payload);
      } catch (e) {
        return json(res, 503, { error: 'The news tunnel is reconnecting to its sources.', detail: e.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/news/image') {
      return news.serveImage(res, url.searchParams.get('src') || '');
    }

    // Is a broadcast session on air, and which one? The timing tower, the radio
    // panel and the page's live/countdown gate all read this one answer.
    if (req.method === 'GET' && url.pathname === '/api/live/state') {
      try {
        const state = await sessionstate.getSessionState();
        return json(res, 200, {
          ...state,
          feed: livesignal.health()
        }, { 'Cache-Control': 'no-store' });
      } catch (e) {
        return json(res, 503, { error: 'The session state is unavailable right now.', detail: e.message }, { 'Cache-Control': 'no-store' });
      }
    }

    // Timing tower: built from the real-time feed while a session is on air,
    // and from OpenF1's archive otherwise, cached server-side either way.
    if (req.method === 'GET' && url.pathname === '/api/live/timing') {
      try {
        const payload = await livetiming.getTiming();
        livesignal.release();
        // The page asks once a second, so a probe answer carries only the
        // fingerprint and the freshness of the reading (a few dozen bytes); the
        // full tower is sent only when that fingerprint has moved.
        if (url.searchParams.get('probe') === '1') {
          return json(res, 200, {
            revision: payload.revision,
            inSession: payload.inSession,
            live: payload.live,
            onAir: Boolean(payload.onAir),
            simulated: payload.simulated,
            sessionName: payload.sessionName,
            lap: payload.lap,
            cars: Array.isArray(payload.drivers) ? payload.drivers.length : 0,
            refreshedAt: payload.refreshedAt || payload.updatedAt,
            nextReadAt: payload.nextReadAt,
            cacheMs: payload.cacheMs,
            feed: payload.feed || null,
            updatedAt: payload.updatedAt
          });
        }
        return json(res, 200, payload);
      } catch (e) {
        return json(res, 503, { error: 'Live timing is unavailable right now.', detail: e.message });
      }
    }

    // Team radio: an empty panel is normal (OpenF1 publishes recordings for only
    // some sessions), so this answers 200 with a note instead of an error.
    if (req.method === 'GET' && url.pathname === '/api/live/radio') {
      try {
        const payload = await radio.getRadio();
        livesignal.release();
        return json(res, 200, payload);
      } catch (e) {
        return json(res, 200, { ok: false, enabled: false, items: [], available: 0, transcribed: 0, notice: radio.RIGHTS_NOTICE, error: e.message });
      }
    }

    // The live page asks for the next untranscribed call; the server serialises
    // the work (one clip, one whisper request at a time, with a cooldown) so a
    // crowd of visitors can't multiply the AI spend.
    if (req.method === 'POST' && url.pathname === '/api/live/radio/transcribe') {
      if (!radio.enabled()) return json(res, 200, { ok: false, reason: 'off', message: 'Team radio transcription is switched off in Race Control.' });
      if (radio.busy()) return json(res, 200, { ok: false, reason: 'busy', message: 'Another call is being transcribed.' });
      const wait = radio.cooldownLeft();
      if (wait > 0) return json(res, 200, { ok: false, reason: 'cooldown', retryInMs: wait, message: 'Just transcribed a call.' });
      try {
        const result = await radio.transcribeNext();
        if (!result.done) return json(res, 200, { ok: false, reason: result.reason || 'none', message: result.message });
        return json(res, 200, { ok: true, code: result.code, text: result.text, remaining: result.remaining });
      } catch (e) {
        return json(res, 200, { ok: false, reason: 'error', message: e.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/chat') {
      const db = store.getDoc();
      const messages = pruneChat(db);
      pruneReactions(db);
      const since = Number(url.searchParams.get('since') || 0);
      const fresh = Number.isFinite(since) && since > 0 ? messages.filter((m) => m.id > since) : messages.slice(-60);
      return json(res, 200, {
        live: await chatOpen(),
        status: db.config.status,
        sessionLabel: db.config.sessionLabel,
        updatedAt: db.config.updatedAt,
        messages: fresh.slice(-60),
        total: messages.length,
        reactions: db.chatReactions || {},
        slowSeconds: Math.round(chatGapMs(db) / 1000),
        latest: messages.length ? messages[messages.length - 1].id : 0
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const db = store.getDoc();
      if (!(await chatOpen())) return json(res, 409, { error: 'Live chat opens when race control puts the session on air.' });
      let body;
      try { body = await readBody(req, 2000); } catch (e) { return json(res, 400, { error: e.message }); }
      const ip = req.socket?.remoteAddress || 'unknown';
      const gap = chatGapMs(db);
      if (Date.now() - (chatPosts.get(ip) || 0) < gap) {
        return json(res, 429, { error: gap > CHAT_GAP ? `Slow mode is on — one message every ${Math.round(gap / 1000)} seconds.` : 'Easy on the throttle — one message every few seconds.' });
      }
      const name = cleanLine(body.name, 24) || 'PIT LANE';
      const text = cleanLine(body.text, 280);
      if (text.length < 2) return json(res, 400, { error: 'Write a message before sending.' });
      if (/https?:\/\/|www\./i.test(text)) return json(res, 400, { error: 'Links are not allowed in the live chat.' });
      if (chatPosts.size > 2000) for (const [key, at] of chatPosts) if (Date.now() - at > gap) chatPosts.delete(key);
      chatPosts.set(ip, Date.now());
      pruneChat(db);
      db.chatSeq = (Number(db.chatSeq) || 0) + 1;
      const message = { id: db.chatSeq, name, text, at: new Date().toISOString() };
      db.chat.push(message);
      db.chat = db.chat.slice(-CHAT_MAX);
      await store.save();
      return json(res, 201, { ok: true, message });
    }

    // Tap-to-react on a single line. The count is authoritative on the server
    // and rides the existing poll; this endpoint only toggles one emoji for one
    // viewer and returns the line's fresh counts.
    const reactionMatch = req.method === 'POST' && url.pathname.match(/^\/api\/chat\/(\d+)\/reaction$/);
    if (reactionMatch) {
      const db = store.getDoc();
      if (!(await chatOpen())) return json(res, 409, { error: 'Reactions open when race control puts the session on air.' });
      const id = Number(reactionMatch[1]);
      pruneChat(db);
      pruneReactions(db);
      if (!db.chat.some((m) => m.id === id)) return json(res, 404, { error: 'That line is no longer on the board.' });
      let body;
      try { body = await readBody(req, 800); } catch (e) { return json(res, 400, { error: e.message }); }
      const emoji = String(body.emoji || '');
      if (!REACT_SET.includes(emoji)) return json(res, 400, { error: 'That reaction is not on the board.' });
      const uid = String(body.uid || '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(uid)) return json(res, 400, { error: 'Reactor session is invalid — reload the page.' });
      const ip = req.socket?.remoteAddress || 'unknown';
      if (!reactionAllowed(ip)) return json(res, 429, { error: 'Easy on the throttle — reaction limits reset in a few seconds.' });
      const removed = ledgerTake(uid, id, emoji);
      db.chatReactions = db.chatReactions || {};
      const key = String(id);
      const counts = db.chatReactions[key] || (db.chatReactions[key] = {});
      const next = Math.max(0, (Number(counts[emoji]) || 0) + (removed ? -1 : 1));
      if (next === 0) delete counts[emoji]; else counts[emoji] = next;
      if (!Object.keys(counts).length) delete db.chatReactions[key];
      await store.save();
      return json(res, 200, { ok: true, id, emoji, active: !removed, reactions: db.chatReactions[key] || {} });
    }

    if (req.method === 'GET' && url.pathname === '/api/race-control') {
      try {
        const data = await providers.getRaceControl();
        if (!data.sessions.length) throw new Error('No schedule providers available.');
        return json(res, 200, data, { 'Cache-Control': 'public, max-age=30' });
      } catch (e) {
        return json(res, 200, { source: 'fallback', unavailable: true, error: 'Live schedule providers are temporarily unavailable.', updatedAt: null, activeSession: null, nextSession: null, latestSession: null, sessions: [] }, { 'Cache-Control': 'no-store' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/circuits') {
      return json(res, 200, { circuits: Object.values(CIRCUITS) }, { 'Cache-Control': 'public, max-age=600' });
    }

    if (req.method === 'GET' && url.pathname === '/api/calendar') {
      try {
        const races = await buildCalendar();
        if (!races.length) throw new Error('empty');
        await persistSnapshots({ calendar: races });
        return json(res, 200, { source: 'OpenF1 & Jolpica & APEX Circuit Core', year: new Date().getUTCFullYear(), races }, { 'Cache-Control': 'public, max-age=300' });
      } catch {
        return json(res, 200, { source: 'snapshot', year: new Date().getUTCFullYear(), races: store.getDoc().calendar });
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/circuit/')) {
      const query = decodeURIComponent(url.pathname.replace('/api/circuit/', '')).trim();
      const profile = getCircuitProfile(query);
      if (!profile) return json(res, 404, { error: 'Circuit profile not found.' });
      return json(res, 200, { ok: true, circuit: profile }, { 'Cache-Control': 'public, max-age=600' });
    }

    if (req.method === 'GET' && url.pathname === '/api/ai/circuit-briefing') {
      const param = url.searchParams.get('circuit') || '';
      const profile = getCircuitProfile(param);
      if (!profile) return json(res, 400, { error: 'Specify a valid circuit name or key.' });
      try { return json(res, 200, await getCircuitAIBriefing(profile), { 'Cache-Control': 'public, max-age=3600' }); }
      catch (err) { return json(res, 500, { error: err.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/ai/race-engineer') {
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const question = String(body.question || '').trim();
      const context = String(body.context || '').trim();
      if (!question) return json(res, 400, { error: 'Provide a question for the race engineer.' });
      try { return json(res, 200, await askRaceEngineer(question, context)); }
      catch (err) { return json(res, 500, { error: err.message }); }
    }

    if (req.method === 'GET' && url.pathname === '/api/live/telemetry') {
      return json(res, 200, generateLiveTelemetrySnapshot(), { 'Cache-Control': 'no-cache' });
    }

    if (req.method === 'GET' && url.pathname === '/api/paddock/directory') {
      return json(res, 200, { drivers: DRIVERS, teams: TEAMS }, { 'Cache-Control': 'public, max-age=600' });
    }

    if (req.method === 'GET' && url.pathname === '/api/standings') {
      try {
        const fresh = await providers.getStandings();
        if (fresh?.drivers?.length) {
          await persistSnapshots({ standings: fresh });
          return json(res, 200, fresh, { 'Cache-Control': 'public, max-age=300' });
        }
      } catch { /* fall through to saved snapshot */ }
      return json(res, 200, { ...store.getDoc().standings, source: `${store.getDoc().standings.source || 'Saved snapshot'} · providers temporarily unavailable` }, { 'Cache-Control': 'no-store' });
    }

    if (req.method === 'GET' && url.pathname === '/api/timing') {
      try {
        const fresh = await providers.getTiming();
        if (fresh?.rows?.length) {
          await persistSnapshots({ timing: fresh });
          return json(res, 200, fresh, { 'Cache-Control': 'public, max-age=300' });
        }
      } catch { /* fall through to saved snapshot */ }
      return json(res, 200, { ...store.getDoc().timing, source: `${store.getDoc().timing.source || 'Saved snapshot'} · providers temporarily unavailable` }, { 'Cache-Control': 'no-store' });
    }

    if (req.method === 'GET' && url.pathname === '/api/reaction/leaderboard') {
      const db = store.getDoc();
      const all = db.reactions.slice().sort((a, b) => a.milliseconds - b.milliseconds);
      const name = String(url.searchParams.get('name') || '').trim().toLowerCase();
      const personalBest = name ? all.find((x) => x.name.toLowerCase() === name) || null : null;
      return json(res, 200, { scores: all.slice(0, 10), personalBest });
    }

    if (req.method === 'POST' && url.pathname === '/api/reaction') {
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const ms = Number(body.milliseconds);
      const name = String(body.name || 'PIT LANE').trim().replace(/[<>]/g, '').slice(0, 20) || 'PIT LANE';
      if (!Number.isFinite(ms) || ms < 80 || ms > 1500) return json(res, 400, { error: 'Reaction result is outside the valid range.' });
      const db = store.getDoc();
      const prior = db.reactions.filter((x) => x.name === name).sort((a, b) => a.milliseconds - b.milliseconds)[0];
      if (!prior || ms < prior.milliseconds) db.reactions.push({ name, milliseconds: ms, createdAt: new Date().toISOString() });
      db.reactions = db.reactions.slice(-500);
      await store.save();
      return json(res, 201, { ok: true, personalBest: !prior || ms < prior.milliseconds, score: ms });
    }

    if (req.method === 'POST' && url.pathname === '/api/newsletter') {
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const email = String(body.email || '').trim().toLowerCase();
      if (body.consent !== true) return json(res, 400, { error: 'Consent is required to join the newsletter list.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'Enter a valid email address.' });
      const db = store.getDoc();
      if (!db.newsletter.some((x) => x.email === email)) {
        const createdAt = new Date().toISOString();
        db.newsletter.push({ email, createdAt, consentAt: createdAt, consentVersion: '2026-10-12' });
      }
      await store.save();
      return json(res, 201, { ok: true, message: 'You’re on the grid.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/newsletter/unsubscribe') {
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const email = String(body.email || '').trim().toLowerCase();
      const db = store.getDoc();
      const before = db.newsletter.length;
      db.newsletter = db.newsletter.filter((x) => x.email !== email);
      await store.save();
      return json(res, 200, { ok: true, removed: before !== db.newsletter.length, message: before === db.newsletter.length ? 'No subscription was found for that address.' : 'You have been removed from the list.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/config') return json(res, 200, store.getDoc().config);

    // One settings endpoint, merged field by field: the control room saves the
    // broadcast, the announcement banner and the chat rules from separate forms.
    if (req.method === 'PUT' && url.pathname === '/api/admin/config') {
      let body;
      try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
      const db = store.getDoc();
      const next = { ...db.config };
      const notes = [];
      if ('streamUrl' in body) {
        const streamUrl = normaliseEmbed(body.streamUrl);
        if (String(body.streamUrl || '').trim() && !streamUrl) return json(res, 400, { error: 'Paste the provider\u2019s <iframe …> embed code, or an https:// embed URL.' });
        if (streamUrl !== next.streamUrl) notes.push(streamUrl ? 'embed updated' : 'embed cleared');
        next.streamUrl = streamUrl;
      }
      if ('sessionLabel' in body) {
        const sessionLabel = String(body.sessionLabel || '').trim().replace(/[<>]/g, '').slice(0, 80) || 'RACE CONTROL';
        if (sessionLabel !== next.sessionLabel) notes.push(`label → ${sessionLabel}`);
        next.sessionLabel = sessionLabel;
      }
      if ('status' in body) {
        const status = String(body.status || 'scheduled');
        if (!['scheduled', 'live', 'complete'].includes(status)) return json(res, 400, { error: 'Choose scheduled, live or complete.' });
        if (status !== next.status) notes.push(`status → ${status.toUpperCase()}`);
        next.status = status;
      }
      if ('banner' in body) {
        const banner = cleanBanner(body.banner);
        const before = next.banner || {};
        if (banner.enabled !== Boolean(before.enabled) || banner.text !== before.text || banner.tone !== before.tone) {
          notes.push(banner.enabled ? `banner on · ${banner.tone}` : 'banner off');
        }
        next.banner = banner;
      }
      if ('radio' in body) {
        const source = body.radio && typeof body.radio === 'object' ? body.radio : {};
        const enabled = Boolean(source.enabled);
        const model = /^whisper-[a-z0-9.-]+$/.test(String(source.model || '')) ? String(source.model) : radio.DEFAULT_MODEL;
        const before = next.radio || {};
        if (enabled !== Boolean(before.enabled) || model !== before.model) notes.push(enabled ? `radio transcription on · ${model}` : 'radio transcription off');
        next.radio = { enabled, model };
      }
      if ('chatSlowSeconds' in body) {
        const seconds = Number(body.chatSlowSeconds);
        if (!CHAT_SLOW_CHOICES.includes(seconds)) return json(res, 400, { error: 'Choose a slow-mode interval of 0, 5, 15 or 30 seconds.' });
        if (seconds !== Number(next.chatSlowSeconds || 0)) notes.push(seconds ? `slow mode ${seconds}s` : 'slow mode off');
        next.chatSlowSeconds = seconds;
      }
      if (next.status === 'live' && !next.streamUrl) return json(res, 400, { error: 'Add an embed URL before marking the session live.' });
      if (notes.length) {
        next.updatedAt = new Date().toISOString();
        db.config = next;
        recordAudit(db, 'BROADCAST', notes.join(' · '), actor());
        await store.save();
      } else {
        db.config = next;
      }
      return json(res, 200, { ok: true, config: db.config, changed: notes });
    }

    // Everything the control room needs to answer "is the site healthy?" in one
    // round trip: storage driver, runtime, provider health and tunnel state.
    if (req.method === 'GET' && url.pathname === '/api/admin/diagnostics') {
      const db = store.getDoc();
      let providerHealth = null;
      try { providerHealth = await backendHealth(); } catch (e) { providerHealth = { ok: false, error: e.message }; }
      let tunnel = { ok: false, error: 'tunnel has not run yet' };
      try {
        const payload = await news.getNews({});
        tunnel = { ok: true, total: payload.total, updatedAt: payload.updatedAt, refreshMs: payload.refreshMs, sources: payload.sources };
      } catch (e) { tunnel = { ok: false, error: e.message }; }
      return json(res, 200, {
        storage: store.info(),
        runtime: {
          node: process.version,
          environment: NODE_ENV,
          platform: process.platform,
          uptimeSeconds: Math.round(process.uptime())
        },
        counts: {
          chatMessages: (db.chat || []).length,
          chatReactionLines: Object.keys(db.chatReactions || {}).length,
          subscribers: (db.newsletter || []).length,
          auditEntries: (db.audit || []).length,
          calendarRounds: (db.calendar || []).length
        },
        broadcast: { status: db.config.status, hasEmbed: Boolean(db.config.streamUrl), slowSeconds: chatGapMs(db) / 1000, banner: db.config.banner || {}, label: db.config.sessionLabel },
        providers: providerHealth,
        news: tunnel
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/news/refresh') {
      try {
        const result = await news.refresh();
        const db = store.getDoc();
        recordAudit(db, 'NEWS POLL', `manual refresh · ${result.count} stories merged`, actor());
        await store.save();
        const payload = await news.getNews({});
        return json(res, 200, { ok: true, gained: Boolean(result.gained), total: payload.total, updatedAt: payload.updatedAt, sources: payload.sources });
      } catch (e) {
        return json(res, 502, { error: `The tunnel could not reach its sources: ${e.message}` });
      }
    }

    // Whisper transcription of team radio. With {url} it transcribes one clip and
    // hands the text straight back (nothing stored); with {limit} it fills in the
    // newest pending calls and keeps the transcripts with the panel.
    if (req.method === 'POST' && url.pathname === '/api/admin/radio/transcribe') {
      let body;
      try { body = await readBody(req, 2000); } catch (e) { return json(res, 400, { error: e.message }); }
      const db = store.getDoc();
      try {
        if (body.url) {
          const result = await radio.transcribe(String(body.url));
          recordAudit(db, 'RADIO', `transcribed a clip · ${result.bytes} bytes via ${result.model}`, actor());
          await store.save();
          return json(res, 200, { ok: true, text: result.text, model: result.model, bytes: result.bytes });
        }
        const result = await radio.transcribePending(Number(body.limit) || 2);
        if (result.done) {
          recordAudit(db, 'RADIO', `transcribed ${result.done} call${result.done === 1 ? '' : 's'}`, actor());
          await store.save();
        }
        return json(res, 200, { ok: true, ...result });
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
      const entries = (store.getDoc().audit || []).slice(-60).reverse();
      return json(res, 200, { entries });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/admin/audit') {
      const db = store.getDoc();
      db.audit = [];
      await store.save();
      return json(res, 200, { ok: true });
    }

    // Full store download. The admin credential is deliberately stripped: the
    // export is a data backup, never a way to lift the password hash.
    if (req.method === 'GET' && url.pathname === '/api/admin/export') {
      const { admin, ...safe } = store.getDoc();
      // Taking personal data off the server is exactly the kind of thing the
      // operator log exists to remember.
      recordAudit(store.getDoc(), 'DATA', `store exported · ${(safe.newsletter || []).length} subscribers`, actor());
      await store.save();
      return json(res, 200, { exportedAt: new Date().toISOString(), ...safe }, {
        'Content-Disposition': `attachment; filename="apex-store-${new Date().toISOString().slice(0, 10)}.json"`
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/chat') {
      const db = store.getDoc();
      return json(res, 200, { live: await chatOpen(), messages: pruneChat(db).slice(-100).reverse() });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/chat/')) {
      const id = Number(decodeURIComponent(url.pathname.replace('/api/admin/chat/', '')));
      const db = store.getDoc();
      const before = db.chat.length;
      db.chat = db.chat.filter((m) => m.id !== id);
      if (before !== db.chat.length) {
        delete (db.chatReactions || {})[String(id)];
        recordAudit(db, 'CHAT', `deleted message #${id}`, actor());
        await store.save();
      }
      return json(res, 200, { ok: true, removed: before !== db.chat.length });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/admin/chat') {
      const db = store.getDoc();
      const removed = (db.chat || []).length;
      db.chat = [];
      db.chatReactions = {};
      recordAudit(db, 'CHAT', `cleared the room · ${removed} message${removed === 1 ? '' : 's'}`, actor());
      await store.save();
      return json(res, 200, { ok: true, removed });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/newsletter') return json(res, 200, { subscribers: store.getDoc().newsletter });

    if (req.method === 'DELETE' && url.pathname === '/api/admin/newsletter') {
      const db = store.getDoc();
      const removed = (db.newsletter || []).length;
      db.newsletter = [];
      recordAudit(db, 'NEWSLETTER', `cleared the list · ${removed} address${removed === 1 ? '' : 'es'}`, actor());
      await store.save();
      return json(res, 200, { ok: true, removed });
    }

    return json(res, 404, { error: 'API route not found.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }

  const requested = url.pathname === '/' ? '/index.html' : (PAGE_ALIASES[url.pathname] || url.pathname);
  const normalized = path.posix.normalize(requested);
  if (normalized.split('/').some((part) => part.startsWith('.')) || normalized === '/server.js' || normalized === '/package.json' || normalized.startsWith('/data/')) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const file = path.join(PUBLIC_DIR, normalized.replace(/^[/\\]+/, ''));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Page not found. <a href="/">Return to APEX</a>.');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ['.html', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    res.end(buf);
  });
}

module.exports = { handler };
