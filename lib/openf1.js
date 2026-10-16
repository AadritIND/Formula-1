// Shared OpenF1 client.
//
// Every OpenF1 read goes through here so the whole site stays inside the free
// tier's limits (3 requests per second, 30 per minute): calls are serialised
// with a minimum gap, a 429 is retried with backoff instead of failing the
// page, and a session with a paid plan can pass OPENF1_API_KEY for live data.

const BASE = (process.env.OPENF1_API_URL || 'https://api.openf1.org/v1').replace(/\/$/, '');
const API_KEY = process.env.OPENF1_API_KEY || '';
const FETCH_TIMEOUT_MS = envInt('APEX_OPENF1_TIMEOUT_MS', 12000);
const MIN_GAP_MS = envInt('APEX_OPENF1_GAP_MS', 400);
const RETRY_DELAYS = [1200, 3000];

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 100 ? Math.floor(n) : fallback;
}

let queue = Promise.resolve();
let lastCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Serialise every request and keep MIN_GAP_MS between them.
function schedule(task) {
  const run = queue.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function once(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: API_KEY ? { Accept: 'application/json', Authorization: `Bearer ${API_KEY}` } : { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (res.status === 404) return [];
  if (res.status === 429) {
    const error = new Error(`OpenF1 rate limit reached on ${path.split('?')[0]}`);
    error.retryable = true;
    throw error;
  }
  if (!res.ok) throw new Error(`OpenF1 ${path.split('?')[0]} returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function api(path) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await schedule(() => once(path));
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === RETRY_DELAYS.length) throw error;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  throw lastError;
}

module.exports = { api, hasKey: Boolean(API_KEY) };
