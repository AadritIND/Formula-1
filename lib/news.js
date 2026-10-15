// Multi-source Formula 1 news tunnel.
//
// The browser never talks to the publishers. The backend polls a set of RSS /
// Atom sources on an interval, normalises every entry into one shape, dedupes
// cross-posts, and serves the merged list from GET /api/news. Article images
// are relayed through GET /api/news/image so the site CSP can stay tight
// (img-src 'self') and hotlink-protected CDNs still render.
//
// The tunnel is lazy: the first /api/news request starts a background refresh
// loop (unref'd, so it never keeps a process alive) and every later request is
// answered from memory while the loop keeps the cache warm. A best-effort file
// snapshot survives local restarts; on read-only serverless filesystems the
// memory copy simply starts empty and refills on first use.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'news-cache.json');

const FEEDS = [
  { id: 'motorsport', name: 'MOTORSPORT.COM', url: 'https://www.motorsport.com/rss/f1/news/', home: 'https://www.motorsport.com/f1/news/' },
  { id: 'autosport', name: 'AUTOSPORT', url: 'https://www.autosport.com/rss/f1/news/', home: 'https://www.autosport.com/f1/news/' },
  { id: 'crash', name: 'CRASH.NET', url: 'https://www.crash.net/rss/f1', home: 'https://www.crash.net/f1' },
  { id: 'bbc', name: 'BBC SPORT', url: 'https://feeds.bbci.co.uk/sport/0/formula1/rss.xml', home: 'https://www.bbc.co.uk/sport/formula1' },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com/espn/rss/f1/news', home: 'https://www.espn.com/f1/' },
  { id: 'racefans', name: 'RACEFANS', url: 'https://racefans.net/feed/', home: 'https://racefans.net/' }
];

const REFRESH_MS = envInt('APEX_NEWS_REFRESH_MS', 3 * 60 * 1000); // tunnel tick + cache TTL
const FETCH_TIMEOUT_MS = 8000;
const MANUAL_REFRESH_GAP_MS = 30 * 1000; // throttle ?refresh=1
const MAX_ITEMS = 60;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; APEXNewsTunnel/1.0; +fan project)';

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
}

// --- Feed text helpers ------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  times: '×', middot: '·', copy: '©', reg: '®', pound: '£', euro: '€'
};

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function squash(value, max) {
  const text = decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function pick(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  const inner = match[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : inner).trim();
}

function pickAttr(block, tag, attr) {
  const match = block.match(new RegExp(`<${tag}[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
}

// Canonicalise an image URL from a feed. Mixed-content http images never render
// on an https page, so they are upgraded to https up front; if the host does
// not speak https the image relay reports the failure and the page falls back
// to a typographic source card.
function asImageUrl(raw) {
  if (!raw) return '';
  const value = decodeEntities(String(raw).trim());
  if (value.startsWith('//')) return `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return '';
    return url.href;
  } catch { return ''; }
}

function imageLike(url) {
  if (!url) return false;
  try { return /\.(jpe?g|png|webp|gif|avif|svg)(\?|#|$)/i.test(new URL(url).pathname); }
  catch { return false; }
}

function canonicalUrl(raw) {
  const value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1 && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/$/, '');
    return url.href;
  } catch { return ''; }
}

function itemKey(url, title) {
  const canonical = canonicalUrl(url);
  if (canonical) return `u:${canonical}`;
  return `t:${squash(title, 200).toLowerCase()}`;
}

function hashKey(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function titleKey(title) {
  return squash(title, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// --- Parsing ----------------------------------------------------------------

function pickImage(block) {
  const enclosure = pickAttr(block, 'enclosure', 'url');
  const enclosureType = pickAttr(block, 'enclosure', 'type');
  const candidates = [
    enclosureType.startsWith('image/') ? enclosure : '',
    pickAttr(block, 'media:content', 'url'),
    pickAttr(block, 'media:thumbnail', 'url'),
    pickAttr(block, 'itunes:image', 'href'),
    pick(block, 'url'),
    pickAttr(block, 'image', 'href')
  ];
  // An <img> inside the HTML description is the last resort.
  const img = block.match(/<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  if (img) candidates.push(img[1]);
  for (const candidate of candidates) {
    const url = asImageUrl(candidate);
    if (url && (imageLike(url) || candidate === enclosure)) {
      // BBC serves the same asset at several widths; ask for the large crop.
      return url.replace('/ace/standard/240/', '/ace/standard/660/');
    }
  }
  return '';
}

function toItem(block, feed, nowIso) {
  const title = squash(pick(block, 'title'), 200);
  let link = pick(block, 'link');
  if (!link || !/^https?:\/\//i.test(link)) {
    const href = block.match(/<link[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
    link = href ? href[1] : '';
  }
  const url = canonicalUrl(link);
  if (!title || !url) return null;
  const dateRaw = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || pick(block, 'date');
  const ts = Date.parse(decodeEntities(dateRaw));
  const published = Number.isFinite(ts) ? new Date(ts).toISOString() : nowIso;
  let summary = squash(pick(block, 'description') || pick(block, 'content:encoded') || pick(block, 'summary'), 260);
  summary = summary.replace(/\s*(keep reading|read more|continue reading)\.?$/i, '').trim();
  const image = pickImage(block);
  const key = itemKey(url, title);
  return { id: hashKey(key), source: feed.name, sourceId: feed.id, title, url, image, summary, published };
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(?:item|entry)>/gi) || [];
  const nowIso = new Date().toISOString();
  const items = [];
  for (const block of blocks.slice(0, 30)) {
    const item = toItem(block, feed, nowIso);
    if (item) items.push(item);
  }
  if (!items.length) throw new Error('feed returned no parseable entries');
  return items;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<(item|entry)[\s>]/i.test(xml)) throw new Error('response is not a feed');
  return parseFeed(xml, feed);
}

// --- Tunnel state -----------------------------------------------------------

const state = {
  items: [],
  sources: {},
  updatedAt: '',
  lastManualRefresh: 0
};
const allowedImages = new Set();
let inflight = null;
let tunnelTimer = null;

function rebuildImageAllowlist() {
  allowedImages.clear();
  for (const item of state.items) if (item.image) allowedImages.add(item.image);
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(cached.items)) state.items = cached.items.slice(0, MAX_ITEMS);
    if (cached.sources && typeof cached.sources === 'object') state.sources = cached.sources;
    if (typeof cached.updatedAt === 'string') state.updatedAt = cached.updatedAt;
    rebuildImageAllowlist();
  } catch { /* corrupt cache: refill from the feeds */ }
}

function persistCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ items: state.items, sources: state.sources, updatedAt: state.updatedAt }));
  } catch { /* read-only filesystem (serverless): memory cache is enough */ }
}

async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    const results = await Promise.all(FEEDS.map(async (feed) => {
      try { return { feed, items: await fetchFeed(feed), error: '' }; }
      catch (error) { return { feed, items: null, error: String(error.message || error) }; }
    }));

    const now = Date.now();
    const byId = new Map(state.items.map((item) => [item.id, item]));
    for (const result of results) {
      state.sources[result.feed.id] = {
        ok: Boolean(result.items),
        count: result.items ? result.items.length : (state.sources[result.feed.id]?.count || 0),
        error: result.error,
        checkedAt: new Date(now).toISOString()
      };
      // A failed feed keeps its previously merged stories; the site should
      // degrade to a slightly stale stream rather than losing the source.
      if (result.items) for (const item of result.items) if (!byId.has(item.id)) byId.set(item.id, item);
    }

    const sorted = [...byId.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    const seenTitles = new Set();
    const merged = [];
    for (const item of sorted) {
      const title = titleKey(item.title);
      if (title && seenTitles.has(title)) continue; // same wire story printed by two outlets
      if (title) seenTitles.add(title);
      merged.push(item);
      if (merged.length >= MAX_ITEMS) break;
    }

    const hadItems = state.items.length > 0;
    const gained = merged.some((item) => !state.items.some((old) => old.id === item.id));
    state.items = merged;
    state.updatedAt = new Date(now).toISOString();
    rebuildImageAllowlist();
    persistCache();

    if (!state.items.length) {
      const errors = results.filter((r) => r.error).map((r) => `${r.feed.name}: ${r.error}`);
      throw new Error(errors.length ? `all feeds failed (${errors.join('; ')})` : 'no news available');
    }
    return { gained: gained || !hadItems, count: state.items.length };
  })().finally(() => { inflight = null; });
  return inflight;
}

function startTunnel() {
  if (tunnelTimer) return;
  tunnelTimer = setInterval(() => { refresh().catch(() => { /* keep the last good snapshot */ }); }, REFRESH_MS);
  if (typeof tunnelTimer.unref === 'function') tunnelTimer.unref();
}

function payload() {
  return {
    ok: true,
    updatedAt: state.updatedAt,
    refreshMs: REFRESH_MS,
    total: state.items.length,
    sources: FEEDS.map((feed) => {
      const source = state.sources[feed.id] || {};
      return {
        id: feed.id,
        name: feed.name,
        home: feed.home,
        ok: Boolean(source.ok),
        count: Number(source.count) || 0,
        error: source.error || '',
        checkedAt: source.checkedAt || null
      };
    }),
    items: state.items.map((item) => ({
      ...item,
      image: item.image ? `/api/news/image?src=${encodeURIComponent(item.image)}` : ''
    }))
  };
}

// Public entry: called by the handler for GET /api/news.
async function getNews(options = {}) {
  startTunnel();
  const now = Date.now();
  const stale = !state.updatedAt || now - Date.parse(state.updatedAt) > REFRESH_MS;
  if (options.force && now - state.lastManualRefresh >= MANUAL_REFRESH_GAP_MS) {
    state.lastManualRefresh = now;
    await refresh();
  } else if (stale) {
    await refresh();
  }
  if (!state.items.length) throw new Error('news tunnel has no items');
  return payload();
}

function imageError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

// Public entry: GET /api/news/image?src=<canonical feed image URL>.
// Only URLs handed out by the current payload are relayable, so the endpoint
// cannot be used as a general proxy.
async function serveImage(res, src) {
  let href = '';
  try { const url = new URL(src); if (url.protocol === 'https:') href = url.href; } catch { /* not a URL */ }
  if (!href || !allowedImages.has(href)) return imageError(res, 404, 'Unknown image source.');
  try {
    const upstream = await fetch(href, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok || !upstream.body) return imageError(res, 502, 'Image unavailable.');
    const type = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) return imageError(res, 502, 'Upstream response is not an image.');
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) return imageError(res, 413, 'Image too large.');

    const chunks = [];
    let size = 0;
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        try { await reader.cancel(); } catch { /* already closing */ }
        return imageError(res, 413, 'Image too large.');
      }
      chunks.push(Buffer.from(value));
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(size),
      'Cache-Control': 'public, max-age=21600',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(Buffer.concat(chunks));
    return true;
  } catch (error) {
    return imageError(res, 502, 'Image unavailable.');
  }
}

loadCache();

module.exports = { getNews, serveImage, refresh, FEEDS, REFRESH_MS };
