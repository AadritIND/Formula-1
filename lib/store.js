// Persistent store with multiple interchangeable backends.
//
// Priority order:
//   1. Upstash / Vercel KV REST  (UPSTASH_REDIS_REST_* or KV_REST_API_*)
//   2. Vercel Blob (private)     (BLOB_READ_WRITE_TOKEN)
//   3. Local JSON file           (data/site.json, writable filesystems)
//   4. In-memory                 (last resort, resets per serverless instance)
//
// The in-memory copy is always the read source for a warm instance; writes flow
// through to whichever backend is active.

const fs = require('node:fs');
const path = require('node:path');
const { DB_FILE, DATA_DIR } = require('./config');
const SEED = require('./seed');

const BLOB_KEY = 'apex/site.json';
const KV_KEY = 'apex:site';

let doc = null;
let driver = 'uninitialised';
let loadPromise = null;

function seedDoc() {
  return JSON.parse(JSON.stringify(SEED));
}

function normalise(data) {
  const base = seedDoc();
  if (!data || typeof data !== 'object') return base;
  return {
    config: { ...base.config, ...(data.config || {}) },
    calendar: Array.isArray(data.calendar) ? data.calendar : base.calendar,
    standings: data.standings && typeof data.standings === 'object' ? data.standings : base.standings,
    timing: data.timing && typeof data.timing === 'object' ? data.timing : base.timing,
    reactions: Array.isArray(data.reactions) ? data.reactions : [],
    newsletter: Array.isArray(data.newsletter) ? data.newsletter : [],
    // Live chat only exists while an operator has the session marked live, so the
    // log follows the broadcast rather than living on the page.
    chat: Array.isArray(data.chat) ? data.chat : [],
    chatSeq: Number.isFinite(data.chatSeq) ? data.chatSeq : 0,
    // Per-line emoji reaction counts keyed by chat message id: { "12": { "🔥": 3 } }.
    chatReactions: data.chatReactions && typeof data.chatReactions === 'object' && !Array.isArray(data.chatReactions) ? data.chatReactions : {},
    // Team radio transcripts live beside the chat they belong to.
    radioTranscripts: data.radioTranscripts && typeof data.radioTranscripts === 'object' && !Array.isArray(data.radioTranscripts) ? data.radioTranscripts : {},
    // Operator action trail shown in the control room.
    audit: Array.isArray(data.audit) ? data.audit.slice(-200) : [],
    // Control-room accounts and their invitations. These must survive every
    // save/load round trip or operators would be locked out of their own panel.
    operators: Array.isArray(data.operators) ? data.operators : [],
    invites: Array.isArray(data.invites) ? data.invites.slice(-20) : [],
    // Preserve a locally bootstrapped admin credential across reloads. In
    // production the password comes from APEX_ADMIN_PASSWORD instead.
    admin: data.admin && typeof data.admin === 'object' ? data.admin : undefined
  };
}

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url, token } : null;
}

async function kvRead() {
  const cfg = kvConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/get/${encodeURIComponent(KV_KEY)}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`KV read ${res.status}`);
  const body = await res.json();
  if (!body || body.result == null) return null;
  return JSON.parse(body.result);
}

async function kvWrite(data) {
  const cfg = kvConfig();
  if (!cfg) throw new Error('KV not configured');
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', KV_KEY, JSON.stringify(data)]),
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`KV write ${res.status}`);
  return true;
}

function blobModule() {
  try {
    return require('@vercel/blob');
  } catch {
    return null;
  }
}

// Vercel Blob can be authorised two ways: a static read-write token, or the
// OIDC connection created by `vercel storage connect`. With OIDC the runtime
// supplies the token via request context / VERCEL_OIDC_TOKEN, so the presence of
// BLOB_STORE_ID is the reliable signal that Blob is configured.
function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function blobRead() {
  const blob = blobModule();
  if (!blob || !blobConfigured()) return null;
  const result = await blob.get(BLOB_KEY, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function blobWrite(data) {
  const blob = blobModule();
  if (!blob || !blobConfigured()) throw new Error('Blob not configured');
  await blob.put(BLOB_KEY, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
  return true;
}

function fileRead() {
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function fileWrite(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DB_FILE);
  return true;
}

function preferredDriver() {
  if (kvConfig()) return 'upstash';
  if (blobConfigured()) return 'blob';
  return 'file';
}

async function load() {
  if (doc) return doc;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const preferred = preferredDriver();
    if (preferred === 'upstash') {
      try {
        const data = await kvRead();
        if (data) { doc = normalise(data); driver = 'upstash'; return doc; }
        doc = seedDoc();
        try { await kvWrite(doc); } catch { /* keep memory copy */ }
        driver = 'upstash';
        return doc;
      } catch { /* fall through */ }
    }
    if (preferred === 'blob') {
      try {
        const data = await blobRead();
        if (data) { doc = normalise(data); driver = 'blob'; return doc; }
        doc = seedDoc();
        try { await blobWrite(doc); } catch { /* keep memory copy */ }
        driver = 'blob';
        return doc;
      } catch { /* fall through */ }
    }
    try {
      const data = fileRead();
      doc = normalise(data);
      // Confirm the filesystem is writable; otherwise keep the data in memory.
      try { fileWrite(doc); driver = 'file'; }
      catch { driver = 'memory'; }
      return doc;
    } catch {
      doc = seedDoc();
      driver = 'memory';
      return doc;
    }
  })();
  return loadPromise;
}

async function save() {
  const data = doc || seedDoc();
  if (driver === 'upstash') {
    try { await kvWrite(data); return true; }
    catch { driver = 'memory'; return false; }
  }
  if (driver === 'blob') {
    try { await blobWrite(data); return true; }
    catch { driver = 'memory'; return false; }
  }
  try { fileWrite(data); driver = 'file'; return true; }
  catch { driver = 'memory'; return false; }
}

function getDoc() {
  return doc || seedDoc();
}

function info() {
  return {
    driver,
    persistent: driver === 'upstash' || driver === 'blob' || driver === 'file',
    backends: {
      upstash: Boolean(kvConfig()),
      blob: blobConfigured(),
      file: driver === 'file'
    }
  };
}

module.exports = { load, save, getDoc, info, seedDoc };
