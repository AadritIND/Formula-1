// Operator accounts for the control room.
//
// The control room used to have a single password, so everyone who could touch
// the broadcast shared one credential and the audit log had no way to say who
// did what. This module gives each operator their own account, a role that
// decides which routes they may touch, and a TOTP second factor.
//
// Three rules shape it:
//
//   * Nobody is handed a password. An owner issues a one-time invitation, and
//     the operator sets their own password and enrols their own authenticator.
//   * An account without a confirmed authenticator cannot sign in at all, so a
//     password alone is never enough to reach the control room.
//   * Secrets never leave the server: passwords are scrypt hashed, TOTP secrets
//     are stored only on the account, recovery codes are stored as digests, and
//     invitation tokens are stored hashed.

const crypto = require('node:crypto');
const totp = require('./totp');

const ROLES = {
  owner: {
    label: 'OWNER',
    blurb: 'Full control, including operator accounts, data exports and the audit log.',
    permissions: ['config', 'chat', 'news', 'radio', 'diagnostics', 'audit', 'audit:clear', 'export', 'operators']
  },
  operator: {
    label: 'OPERATOR',
    blurb: 'Runs the show: broadcast, banner, chat rules, news polls and radio. No account or export access.',
    permissions: ['config', 'chat', 'news', 'radio', 'diagnostics', 'audit']
  },
  moderator: {
    label: 'MODERATOR',
    blurb: 'Live chat only: reads the log and removes lines. Cannot change the broadcast.',
    permissions: ['chat']
  }
};

const ROLE_NAMES = Object.keys(ROLES);
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;
const NAME_MAX = 40;
const INVITE_TTL_MS = 30 * 60 * 1000;
const RECOVERY_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const SIGN_IN_LIMIT = 5;

// --- small helpers ----------------------------------------------------------

function can(role, permission) {
  const entry = ROLES[role];
  return Boolean(entry && entry.permissions.includes(permission));
}

function clean(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanName(value) {
  return clean(value, NAME_MAX);
}

function cleanEmail(value) {
  const email = clean(value, 120).toLowerCase();
  if (!email) return '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN) return `Choose a password of at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Keep the password under ${PASSWORD_MAX} characters.`;
  return '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sameDigest(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

// --- passwords --------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPassword(record, password) {
  if (!record || !record.salt || !record.hash) return false;
  const provided = crypto.scryptSync(String(password || ''), Buffer.from(record.salt, 'hex'), 64);
  const expected = Buffer.from(record.hash, 'hex');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

// A missing account still pays the scrypt cost, so sign-in timing doesn't
// reveal which account names exist.
const DUMMY = (() => {
  const salt = Buffer.alloc(16, 7);
  return { salt: salt.toString('hex'), hash: crypto.scryptSync('not-a-real-password', salt, 64).toString('hex') };
})();

// --- accounts ---------------------------------------------------------------

function accounts(db) {
  if (!Array.isArray(db.operators)) db.operators = [];
  return db.operators;
}

function findAccount(db, id) {
  return accounts(db).find((entry) => entry.id === id) || null;
}

function findByIdentity(db, identity) {
  const needle = clean(identity, 120).toLowerCase();
  if (!needle) return null;
  return accounts(db).find((entry) => entry.name.toLowerCase() === needle || (entry.email && entry.email === needle)) || null;
}

function ownedTemplates(db) {
  return accounts(db).filter((entry) => entry.role === 'owner' && !entry.disabled).length;
}

function publicAccount(record) {
  const state = record.totp || {};
  return {
    id: record.id,
    name: record.name,
    email: record.email || '',
    role: record.role,
    roleLabel: (ROLES[record.role] || {}).label || record.role,
    roleBlurb: (ROLES[record.role] || {}).blurb || '',
    disabled: Boolean(record.disabled),
    createdAt: record.createdAt || null,
    createdBy: record.createdBy || '',
    lastLoginAt: record.lastLoginAt || null,
    mfa: {
      enrolled: Boolean(state.secret && state.confirmedAt),
      awaiting: Boolean(state.pendingSecret && !state.confirmedAt),
      confirmedAt: state.confirmedAt || null,
      recoveryLeft: (record.recovery || []).filter((entry) => !entry.usedAt).length
    }
  };
}

function listAccounts(db) {
  return accounts(db)
    .map(publicAccount)
    .sort((a, b) => ROLE_NAMES.indexOf(a.role) - ROLE_NAMES.indexOf(b.role) || a.name.localeCompare(b.name));
}

function bumpVersion(record) {
  record.ver = Number(record.ver || 1) + 1;
  return record.ver;
}

function createAccount(db, options) {
  const { name, email, role, password, createdBy = '', accountId = null } = options;
  const label = cleanName(name);
  const address = cleanEmail(email);
  const grantedRole = ROLE_NAMES.includes(role) ? role : 'moderator';
  const record = {
    id: accountId || crypto.randomUUID(),
    name: label,
    email: address || '',
    role: grantedRole,
    salt: '',
    hash: '',
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || '').slice(0, NAME_MAX),
    lastLoginAt: null,
    disabled: false,
    ver: 1,
    totp: null,
    recovery: []
  };
  if (password) {
    const { salt, hash } = hashPassword(password);
    record.salt = salt;
    record.hash = hash;
  }
  accounts(db).push(record);
  return record;
}

function setPassword(record, password) {
  const { salt, hash } = hashPassword(password);
  record.salt = salt;
  record.hash = hash;
  bumpVersion(record);
  return record;
}

function setRole(record, role) {
  if (!ROLE_NAMES.includes(role) || record.role === role) return false;
  record.role = role;
  bumpVersion(record);
  return true;
}

function setDisabled(db, record, disabled) {
  if (disabled && record.role === 'owner' && ownedTemplates(db) <= 1) {
    return { ok: false, error: 'Keep at least one active owner account.' };
  }
  record.disabled = Boolean(disabled);
  bumpVersion(record);
  return { ok: true };
}

function removeAccount(db, record) {
  if (record.role === 'owner' && ownedTemplates(db) <= 1) {
    return { ok: false, error: 'Keep at least one active owner account.' };
  }
  db.operators = accounts(db).filter((entry) => entry.id !== record.id);
  // An invitation still in flight for this account would only confuse things.
  db.invites = (Array.isArray(db.invites) ? db.invites : []).filter((entry) => entry.accountId !== record.id);
  return { ok: true };
}

// --- second factor ----------------------------------------------------------

function startEnrolment(record) {
  const secret = totp.generateSecret();
  record.totp = { ...(record.totp || {}), pendingSecret: secret, confirmedAt: record.totp ? record.totp.confirmedAt || null : null };
  return {
    secret,
    uri: totp.otpauthUri({ secret, label: record.email || record.name || 'operator' }),
    digits: totp.DIGITS,
    step: totp.STEP_SECONDS
  };
}

function generateRecoveryCodes(record) {
  const codes = [];
  const now = new Date().toISOString();
  const stores = [];
  for (let i = 0; i < RECOVERY_COUNT; i += 1) {
    let code = '';
    for (let c = 0; c < 10; c += 1) code += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
    stores.push({ hash: sha256(code), issuedAt: now, usedAt: null });
  }
  record.recovery = stores;
  return codes;
}

function confirmEnrolment(record, code) {
  const pending = record.totp && record.totp.pendingSecret;
  if (!pending) return { ok: false, error: 'Start two-factor setup first.' };
  const result = totp.verify({ secret: pending, token: code });
  if (!result.ok) {
    return { ok: false, error: result.reason === 'replay' ? 'That code has already been used. Wait for the next one.' : 'That code did not match. Check the clock on your authenticator.' };
  }
  record.totp = { secret: pending, confirmedAt: new Date().toISOString(), lastStep: result.step };
  bumpVersion(record);
  const recoveryCodes = generateRecoveryCodes(record);
  return { ok: true, recoveryCodes };
}

// A code may be a 6-digit TOTP or one of the recovery codes issued at enrolment.
function verifySecondFactor(record, code) {
  const raw = String(code || '').trim();
  const state = record.totp || {};
  if (!state.secret || !state.confirmedAt) return { ok: false, reason: 'not-enrolled' };
  if (/^\d{6}$/.test(raw.replace(/\s/g, ''))) {
    const result = totp.verify({
      secret: state.secret,
      token: raw,
      afterStep: Number.isFinite(state.lastStep) ? state.lastStep : null
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    state.lastStep = result.step;
    record.totp = state;
    return { ok: true, via: 'totp' };
  }
  const normalised = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalised.length < 8) return { ok: false, reason: 'format' };
  const digest = sha256(normalised);
  for (const entry of record.recovery || []) {
    if (entry.usedAt) continue;
    if (sameDigest(entry.hash, digest)) {
      entry.usedAt = new Date().toISOString();
      return { ok: true, via: 'recovery', remaining: (record.recovery || []).filter((row) => !row.usedAt).length };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

// --- invitations ------------------------------------------------------------
// One-time, single-use links. The owner hands over a link, never a password.

function inviteHash(token) {
  return sha256(`invite:${token}`);
}

function createInvite(db, options) {
  const { name, email, role, createdBy = '', accountId = null } = options;
  if (!Array.isArray(db.invites)) db.invites = [];
  const token = crypto.randomBytes(24).toString('base64url');
  const invite = {
    id: crypto.randomUUID(),
    hash: inviteHash(token),
    name: cleanName(name),
    email: cleanEmail(email) || '',
    role: ROLE_NAMES.includes(role) ? role : 'moderator',
    accountId,
    // Recorded at issue time: accepting an invitation for an existing account is
    // a re-enrolment, while a fresh account is simply activated. The accountId
    // itself is filled in later, so it cannot be used to tell the two apart.
    reEnrolment: Boolean(accountId),
    createdBy: String(createdBy || '').slice(0, NAME_MAX),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    usedAt: null
  };
  // Only the newest handful are worth keeping; expired ones are dead weight.
  db.invites = db.invites.filter((entry) => !entry.usedAt && Date.parse(entry.expiresAt) > Date.now()).slice(-20);
  db.invites.push(invite);
  return { invite, token, expiresAt: invite.expiresAt, path: `/admin?invite=${token}` };
}

function findInvite(db, token) {
  const hash = inviteHash(String(token || ''));
  const invite = (Array.isArray(db.invites) ? db.invites : []).find((entry) => sameDigest(entry.hash, hash));
  if (!invite) return { ok: false, error: 'That invitation link is not valid.' };
  if (invite.usedAt) return { ok: false, error: 'That invitation has already been used.' };
  if (Date.parse(invite.expiresAt) < Date.now()) return { ok: false, error: 'That invitation has expired. Ask an owner for a new one.' };
  return { ok: true, invite };
}

function listInvites(db) {
  return (Array.isArray(db.invites) ? db.invites : [])
    .filter((entry) => !entry.usedAt && Date.parse(entry.expiresAt) > Date.now())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      email: entry.email,
      role: entry.role,
      roleLabel: (ROLES[entry.role] || {}).label || entry.role,
      createdBy: entry.createdBy,
      expiresAt: entry.expiresAt,
      forAccount: entry.accountId || null
    }));
}

function closeInvite(db, invite) {
  invite.usedAt = new Date().toISOString();
}

// --- sign-in throttling -----------------------------------------------------
// In memory on purpose: it is a speed bump for guessing, not a ledger. Keys are
// "ip:<addr>" and "account:<id>", so one noisy source can't lock out everyone.

const attempts = new Map();

function throttleCheck(key) {
  const entry = attempts.get(key);
  if (!entry || entry.until < Date.now()) return { blocked: false, remaining: SIGN_IN_LIMIT };
  if (entry.count < SIGN_IN_LIMIT) return { blocked: false, remaining: SIGN_IN_LIMIT - entry.count };
  return { blocked: true, retryInSeconds: Math.ceil((entry.until - Date.now()) / 1000) };
}

function throttleFail(key) {
  const entry = attempts.get(key);
  const fresh = !entry || entry.until < Date.now();
  const next = fresh ? { count: 0, until: Date.now() + SIGN_IN_WINDOW_MS } : entry;
  next.count += 1;
  attempts.set(key, next);
  if (attempts.size > 500) {
    for (const [oldest] of attempts) {
      if (attempts.size <= 400) break;
      attempts.delete(oldest);
    }
  }
  return throttleCheck(key);
}

function throttleClear(key) {
  attempts.delete(key);
}

module.exports = {
  ROLES,
  ROLE_NAMES,
  PASSWORD_MIN,
  INVITE_TTL_MS,
  RECOVERY_COUNT,
  can,
  cleanName,
  cleanEmail,
  passwordProblem,
  hashPassword,
  verifyPassword,
  DUMMY,
  accounts,
  findAccount,
  findByIdentity,
  listAccounts,
  publicAccount,
  createAccount,
  setPassword,
  setRole,
  setDisabled,
  removeAccount,
  ownedTemplates,
  bumpVersion,
  startEnrolment,
  confirmEnrolment,
  verifySecondFactor,
  generateRecoveryCodes,
  createInvite,
  findInvite,
  listInvites,
  closeInvite,
  throttleCheck,
  throttleFail,
  throttleClear
};
