// Central configuration and secret loading for the APEX backend.
// Secrets are read from environment variables first (production), then from a
// local apikey.txt for development. The apikey.txt file is never deployed.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'site.json');

function parseKeyFile() {
  const out = { groq: '', gemini: '', openrouter: '' };
  try {
    const file = path.join(ROOT, 'apikey.txt');
    if (!fs.existsSync(file)) return out;
    const text = fs.readFileSync(file, 'utf8');
    const groq = text.match(/groq\s*-\s*([^\r\n]+)/i);
    if (groq) out.groq = groq[1].trim();
    const gemini = text.match(/google\s*ai\s*studio\s*-\s*([^\r\n]+)/i);
    if (gemini) out.gemini = gemini[1].trim();
    const openrouter = text.match(/openrouter\s*-\s*([^\r\n]+)/i);
    if (openrouter) out.openrouter = openrouter[1].trim();
  } catch {
    // Ignore: environment variables are the production source of truth.
  }
  return out;
}

const fileKeys = parseKeyFile();

const KEYS = {
  groq: process.env.GROQ_API_KEY || fileKeys.groq || '',
  gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || fileKeys.gemini || '',
  openrouter: process.env.OPENROUTER_API_KEY || fileKeys.openrouter || ''
};

const ADMIN_PASSWORD = process.env.APEX_ADMIN_PASSWORD || '';
if (ADMIN_PASSWORD && ADMIN_PASSWORD.length < 12) {
  console.error('APEX_ADMIN_PASSWORD must contain at least 12 characters.');
  process.exit(1);
}

module.exports = {
  ROOT,
  PUBLIC_DIR,
  DATA_DIR,
  DB_FILE,
  KEYS,
  ADMIN_PASSWORD,
  GROQ_MODEL: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'openrouter/auto',
  SESSION_SECRET: process.env.APEX_SESSION_SECRET || ADMIN_PASSWORD || 'apex-local-development-secret',
  SESSION_TTL_MS: 8 * 60 * 60 * 1000,
  IS_VERCEL: Boolean(process.env.VERCEL),
  NODE_ENV: process.env.NODE_ENV || 'development'
};
