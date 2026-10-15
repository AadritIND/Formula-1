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

const LOGIN_WINDOW = 15 * 60 * 1000;
const loginAttempts = new Map();

// --- Live chat --------------------------------------------------------------
// The chat is a window onto the current broadcast rather than a permanent room:
// posting is refused unless an operator has the session marked live, and the log
// is capped and expires so the store stays small between race weekends.

const CHAT_MAX = 200;
const CHAT_TTL = 12 * 60 * 60 * 1000;
const CHAT_GAP = 4000;
const chatPosts = new Map();

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

function chatOpen(db) {
  return db.config?.status === 'live';
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

// --- Stateless admin sessions ----------------------------------------------
// Tokens are HMAC-signed so they survive serverless cold starts and scale
// across instances without shared memory.

function signSession(expires) {
  const payload = `${expires}.${crypto.randomBytes(8).toString('hex')}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return false;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return false; }
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expires = Number(payload.split('.')[0]);
  return Number.isFinite(expires) && expires > Date.now();
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
  return verifySession(cookies(req).apex_admin);
}

function adminConfigured() {
  return Boolean(ADMIN_PASSWORD || store.getDoc().admin?.salt);
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

function validEmbed(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return (h === 'www.youtube.com' && u.pathname.startsWith('/embed/')) ||
      (h === 'www.youtube-nocookie.com' && u.pathname.startsWith('/embed/')) ||
      (h === 'player.vimeo.com' && u.pathname.startsWith('/video/'));
  } catch { return false; }
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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https://media.formula1.com https://www.formula1.com https://*.formula1.com https://*.cloudfront.net https://*.ytimg.com https://*.vimeocdn.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self' https://api.openf1.org https://api.jolpi.ca https://api.groq.com https://generativelanguage.googleapis.com https://openrouter.ai; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

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

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      if (!adminConfigured()) return json(res, 409, { error: 'Set an admin password before signing in.' });
      const ip = req.socket?.remoteAddress || 'unknown';
      const attempt = loginAttempts.get(ip);
      if (attempt && attempt.until > Date.now() && attempt.count >= 5) return json(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const db = store.getDoc();
      let matched = false;
      if (ADMIN_PASSWORD) {
        const provided = crypto.createHash('sha256').update(String(body.password || '')).digest();
        const expected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
        matched = crypto.timingSafeEqual(provided, expected);
      } else if (db.admin?.salt && db.admin?.hash) {
        const provided = crypto.scryptSync(String(body.password || ''), Buffer.from(db.admin.salt, 'hex'), 64);
        matched = crypto.timingSafeEqual(provided, Buffer.from(db.admin.hash, 'hex'));
      }
      if (!matched) {
        const old = attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + LOGIN_WINDOW };
        old.count += 1;
        loginAttempts.set(ip, old);
        return json(res, 401, { error: 'Password did not match.' });
      }
      loginAttempts.delete(ip);
      const token = signSession(Date.now() + SESSION_TTL_MS);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/bootstrap') {
      if (ADMIN_PASSWORD || store.getDoc().admin?.salt) return json(res, 409, { error: 'Admin access has already been configured.' });
      if (!localBootstrapRequest(req)) return json(res, 403, { error: 'First-run setup is only available from localhost.' });
      let body;
      try { body = await readBody(req, 4000); } catch (e) { return json(res, 400, { error: e.message }); }
      const password = String(body.password || '');
      if (password.length < 12 || password.length > 200) return json(res, 400, { error: 'Choose a password between 12 and 200 characters.' });
      const salt = crypto.randomBytes(16);
      const hash = crypto.scryptSync(password, salt, 64);
      const db = store.getDoc();
      db.admin = { salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: new Date().toISOString() };
      await store.save();
      const token = signSession(Date.now() + SESSION_TTL_MS);
      return json(res, 201, { ok: true }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/status') {
      return json(res, 200, { authenticated: authorized(req), configured: adminConfigured(), canBootstrap: !adminConfigured() && localBootstrapRequest(req) });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
    }

    if (url.pathname.startsWith('/api/admin/') && !authorized(req)) return json(res, 401, { error: 'Sign in to the admin panel.' });

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

    if (req.method === 'GET' && url.pathname === '/api/chat') {
      const db = store.getDoc();
      const messages = pruneChat(db);
      pruneReactions(db);
      const since = Number(url.searchParams.get('since') || 0);
      const fresh = Number.isFinite(since) && since > 0 ? messages.filter((m) => m.id > since) : messages.slice(-60);
      return json(res, 200, {
        live: chatOpen(db),
        status: db.config.status,
        sessionLabel: db.config.sessionLabel,
        updatedAt: db.config.updatedAt,
        messages: fresh.slice(-60),
        total: messages.length,
        reactions: db.chatReactions || {},
        latest: messages.length ? messages[messages.length - 1].id : 0
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const db = store.getDoc();
      if (!chatOpen(db)) return json(res, 409, { error: 'Live chat opens when race control puts the session on air.' });
      let body;
      try { body = await readBody(req, 2000); } catch (e) { return json(res, 400, { error: e.message }); }
      const ip = req.socket?.remoteAddress || 'unknown';
      if (Date.now() - (chatPosts.get(ip) || 0) < CHAT_GAP) return json(res, 429, { error: 'Easy on the throttle — one message every few seconds.' });
      const name = cleanLine(body.name, 24) || 'PIT LANE';
      const text = cleanLine(body.text, 280);
      if (text.length < 2) return json(res, 400, { error: 'Write a message before sending.' });
      if (/https?:\/\/|www\./i.test(text)) return json(res, 400, { error: 'Links are not allowed in the live chat.' });
      if (chatPosts.size > 2000) for (const [key, at] of chatPosts) if (Date.now() - at > CHAT_GAP) chatPosts.delete(key);
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
      if (!chatOpen(db)) return json(res, 409, { error: 'Reactions open when race control puts the session on air.' });
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

    if (req.method === 'PUT' && url.pathname === '/api/admin/config') {
      let body;
      try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
      const streamUrl = String(body.streamUrl || '').trim();
      const sessionLabel = String(body.sessionLabel || '').trim().replace(/[<>]/g, '').slice(0, 80);
      const status = String(body.status || 'scheduled');
      if (streamUrl && !validEmbed(streamUrl)) return json(res, 400, { error: 'Use an https:// YouTube /embed or Vimeo /video embed URL.' });
      if (!['scheduled', 'live', 'complete'].includes(status)) return json(res, 400, { error: 'Choose scheduled, live or complete.' });
      if (status === 'live' && !streamUrl) return json(res, 400, { error: 'Add an embed URL before marking the session live.' });
      const db = store.getDoc();
      db.config = { streamUrl, sessionLabel: sessionLabel || 'RACE CONTROL', status, updatedAt: new Date().toISOString() };
      await store.save();
      return json(res, 200, { ok: true, config: db.config });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/chat') {
      const db = store.getDoc();
      return json(res, 200, { live: chatOpen(db), messages: pruneChat(db).slice(-100).reverse() });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/chat/')) {
      const id = Number(decodeURIComponent(url.pathname.replace('/api/admin/chat/', '')));
      const db = store.getDoc();
      const before = db.chat.length;
      db.chat = db.chat.filter((m) => m.id !== id);
      if (before !== db.chat.length) {
        delete (db.chatReactions || {})[String(id)];
        await store.save();
      }
      return json(res, 200, { ok: true, removed: before !== db.chat.length });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/admin/chat') {
      const db = store.getDoc();
      db.chat = [];
      db.chatReactions = {};
      await store.save();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/newsletter') return json(res, 200, { subscribers: store.getDoc().newsletter });

    if (req.method === 'DELETE' && url.pathname === '/api/admin/newsletter') {
      const db = store.getDoc();
      db.newsletter = [];
      await store.save();
      return json(res, 200, { ok: true });
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
