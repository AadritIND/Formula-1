// Time-based one-time passwords (RFC 6238) for operator sign-in.
//
// Written against node:crypto rather than a TOTP package so the control room
// keeps its single-dependency footprint. The implementation is the standard
// HOTP construction (RFC 4226) with the time counter from RFC 6238:
//
//   T = floor((now - T0) / step)      T0 = 0, step = 30s
//   HMAC-SHA1(secret, T as 8-byte big-endian)  →  dynamic truncation  →  % 10^digits
//
// Verified against the published RFC 6238 Appendix B vectors in the test suite.

const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const STEP_SECONDS = 30;
const SECRET_BYTES = 20; // 160 bits, the size authenticator apps expect
const DEFAULT_WINDOW = 1; // accept the step either side of "now" for clock drift

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[\s=]/g, '');
  if (!clean) throw new Error('Empty secret.');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secret is not valid base32.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (!bytes.length) throw new Error('Secret is too short.');
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

function counterFor(timeMs, step = STEP_SECONDS) {
  return Math.floor(timeMs / 1000 / step);
}

// The 8-byte big-endian counter, as HOTP requires.
function counterBuffer(counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

function hotp(secret, counter, digits = DIGITS, algorithm = 'sha1') {
  const key = typeof secret === 'string' ? base32Decode(secret) : secret;
  const digest = crypto.createHmac(algorithm, key).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function code(secret, options = {}) {
  const { timeMs = Date.now(), digits = DIGITS, step = STEP_SECONDS, algorithm = 'sha1' } = options;
  return hotp(secret, counterFor(timeMs, step), digits, algorithm);
}

// Compares in constant time so a wrong code cannot be narrowed down by timing.
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Returns { ok, step, afterStep } — afterStep is the step the caller should
// remember so the same code cannot be replayed inside its 30 second window.
function verify(options) {
  const {
    secret,
    token,
    timeMs = Date.now(),
    digits = DIGITS,
    step = STEP_SECONDS,
    window = DEFAULT_WINDOW,
    algorithm = 'sha1',
    afterStep = null
  } = options;
  const submitted = String(token || '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(submitted)) return { ok: false, reason: 'format' };
  let key;
  try { key = base32Decode(secret); } catch { return { ok: false, reason: 'secret' }; }
  const current = counterFor(timeMs, step);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = current + offset;
    if (afterStep !== null && candidate <= afterStep) continue; // already spent
    if (safeEqual(hotp(key, candidate, digits, algorithm), submitted)) return { ok: true, step: candidate };
  }
  return { ok: false, reason: afterStep !== null && current <= afterStep ? 'replay' : 'mismatch' };
}

function otpauthUri(options) {
  const { secret, label, issuer = 'APEX Race Control', digits = DIGITS, step = STEP_SECONDS, algorithm = 'SHA1' } = options;
  const name = encodeURIComponent(`${issuer}:${label || 'operator'}`);
  const params = new URLSearchParams({
    secret: secret,
    issuer: issuer,
    algorithm: String(algorithm).toUpperCase(),
    digits: String(digits),
    period: String(step)
  });
  return `otpauth://totp/${name}?${params.toString()}`;
}

module.exports = {
  generateSecret,
  base32Encode,
  base32Decode,
  code,
  verify,
  otpauthUri,
  DIGITS,
  STEP_SECONDS,
  DEFAULT_WINDOW
};
