// OPTIONAL accounts layer — a thin, self-hostable access gate for the web app.
//
// OFF by default. The whole product is zero-account: identity is an Ed25519 key
// derived client-side from a team password (never sent anywhere), and notes are
// E2EE so the relay only ever sees ciphertext. That stays true whether or not
// accounts are on.
//
// What accounts ADD (when ACCOUNTS_ENABLED=1): a familiar "sign in to our
// company instance" gate in front of the self-hosted web app, so a deployment on
// `docs.yourcompany.com` isn't world-open. It is an ACCESS/CONVENIENCE layer only
// — it CANNOT and does NOT hold any note-decryption key. After signing in, a user
// still joins teams with the team password exactly as before. (This is the honest
// constraint of E2EE: a server account can gate access, never decrypt content.)
//
// Deliberately dependency-free: Node's built-in `crypto` (scrypt password hashing
// + HMAC-signed stateless session tokens) over an atomic JSON file. No database
// to set up, no native modules to compile — it just works in the slim image.
// Fine at small-team scale; swap the store for SQLite behind this same interface
// if a deployment ever outgrows it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENABLED = /^(1|true|yes|on)$/i.test(process.env.ACCOUNTS_ENABLED || '');
// 'open'  → anyone can self-serve sign up (good for a trusted company instance).
// 'closed'→ only the first account (the admin) can be created via signup; further
//           users must be added by the admin. Until the FIRST user exists, signup
//           is always allowed so the instance can be bootstrapped.
const SIGNUP_MODE = (process.env.ACCOUNTS_SIGNUP || 'open').toLowerCase();
// When true, the relay also rejects unauthenticated WebSocket sync (signaling +
// /yjs). Off by default so desktop peers on the default relay keep working; turn
// it on for a strictly web-only, members-only instance.
const STRICT = /^(1|true|yes|on)$/i.test(process.env.ACCOUNTS_STRICT || '');

const DIR = process.env.ACCOUNTS_DIR || path.join(__dirname, '..', '.accounts');
const STORE = path.join(DIR, 'users.json');
// Secret for HMAC-signing session tokens. Set ACCOUNTS_SECRET in prod so sessions
// survive restarts; otherwise we use a per-boot random (sessions reset on deploy).
const SECRET = process.env.ACCOUNTS_SECRET
  || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const COOKIE = 'nl_session';

// Deterministic ROOT admin, seeded from env on first boot (see bootstrap()).
// Set both to guarantee a known super-admin exists the moment the instance comes
// up — instead of "whoever signs up first becomes admin" (a land-grab race on a
// public URL). Re-applying on later boots is a no-op once any user exists.
const ADMIN_EMAIL = process.env.ACCOUNTS_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ACCOUNTS_ADMIN_PASSWORD || '';
// Default lifetime of an admin invite link (override per-invite).
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch (e) {
    return { version: 1, users: [] };
  }
}

function save(db) {
  ensureDir();
  const tmp = `${STORE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, STORE); // atomic replace
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt) {
  // scrypt with sane cost; returns hex. Salt is per-user random hex.
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt,
  };
}

// --- stateless session tokens (HMAC-signed, no server-side session store) ---
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sign(payloadStr) {
  return b64u(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());
}
function issueToken(user) {
  const payload = { uid: user.id, email: user.email, role: user.role, exp: nowMs() + SESSION_TTL_MS };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(unb64u(body).toString('utf8')); } catch (e) { return null; }
  if (!payload || !payload.exp || payload.exp < nowMs()) return null;
  return payload; // { uid, email, role, exp }
}

// Date.now() wrapper kept in one place (the workflow/runtime forbids it in some
// contexts; the relay process is allowed to call it normally).
function nowMs() { return Date.now(); }

// --- public API ---

function count() {
  return load().users.length;
}

function signupAllowed() {
  if (!ENABLED) return false;
  if (count() === 0) return true; // always allow bootstrapping the first (admin) user
  return SIGNUP_MODE === 'open';
}

// Build a fresh user record (hashed password). Does NOT persist.
function makeUser({ email, password, role }) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: crypto.randomUUID(),
    email: normEmail(email),
    salt,
    pwHash: hashPassword(password, salt),
    role: role === 'admin' ? 'admin' : 'member',
    disabled: false,
    createdAt: new Date().toISOString(),
  };
}

// Count enabled admins — used to guard against locking yourself out (you can
// never disable/demote/delete the LAST admin).
function adminCount(db) {
  return db.users.filter((u) => u.role === 'admin' && !u.disabled).length;
}

// { ok, user, token, error }. `invite` (optional) is a one-time admin invite
// token that lets a specific person join even when signup is "closed".
function signup({ email, password, invite }) {
  if (!ENABLED) return { ok: false, error: 'accounts_disabled' };
  const e = normEmail(email);
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'invalid_email' };
  if (!password || String(password).length < 8) return { ok: false, error: 'weak_password' };
  const db = load();
  const first = db.users.length === 0;

  let inv = null;
  if (invite) {
    inv = findInvite(db, invite);
    if (!inv) return { ok: false, error: 'invalid_invite' };
    if (inv.email && normEmail(inv.email) !== e) return { ok: false, error: 'invite_email_mismatch' };
  } else if (!first && SIGNUP_MODE !== 'open') {
    return { ok: false, error: 'signup_closed' };
  }

  if (db.users.some((u) => u.email === e)) return { ok: false, error: 'email_taken' };
  // First user is always admin; an invite may grant admin; otherwise member.
  const role = first || (inv && inv.role === 'admin') ? 'admin' : 'member';
  const user = makeUser({ email: e, password, role });
  db.users.push(user);
  if (inv) inv.usedAt = new Date().toISOString();
  save(db);
  return { ok: true, user: publicUser(user), token: issueToken(user) };
}

// { ok, user, token, error }
function login({ email, password }) {
  if (!ENABLED) return { ok: false, error: 'accounts_disabled' };
  const e = normEmail(email);
  const db = load();
  const user = db.users.find((u) => u.email === e);
  if (!user) return { ok: false, error: 'invalid_credentials' };
  const attempt = hashPassword(password, user.salt);
  const a = Buffer.from(attempt);
  const b = Buffer.from(user.pwHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'invalid_credentials' };
  }
  if (user.disabled) return { ok: false, error: 'account_disabled' };
  return { ok: true, user: publicUser(user), token: issueToken(user) };
}

// Pull a session token from cookie, Authorization header, or ?token=.
function tokenFromReq(req) {
  const hdr = req.headers && req.headers.authorization;
  if (hdr && hdr.startsWith('Bearer ')) return hdr.slice(7).trim();
  const cookie = req.headers && req.headers.cookie;
  if (cookie) {
    const m = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    if (m) return decodeURIComponent(m.slice(COOKIE.length + 1));
  }
  try {
    const u = new URL(req.url, 'http://x');
    const t = u.searchParams.get('token');
    if (t) return t;
  } catch (e) { /* ignore */ }
  return null;
}

function userFromReq(req) {
  return verifyToken(tokenFromReq(req));
}

function cookieHeader(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  // HttpOnly so JS can't read it; SameSite=Lax is fine (same-origin app). Secure
  // is set by the proxy/TLS terminator in prod; we leave it off so local HTTP works.
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// Resolve the LIVE user record behind a request's session token (re-read from the
// store, so role changes / disables / deletions take effect immediately rather
// than waiting for the 30-day token to expire). Returns null if signed out,
// deleted, or disabled.
function currentUser(req) {
  const payload = verifyToken(tokenFromReq(req));
  if (!payload) return null;
  const user = load().users.find((u) => u.id === payload.uid);
  if (!user || user.disabled) return null;
  return user;
}

// The request's user iff they are an enabled admin — the gate for every /admin
// route. Returns the live record (with current role) or null.
function adminFromReq(req) {
  const user = currentUser(req);
  return user && user.role === 'admin' ? user : null;
}

// --- invites (one-time admin-issued signup tokens, stored in the JSON db) ---
function findInvite(db, token) {
  if (!Array.isArray(db.invites)) return null;
  const inv = db.invites.find((i) => i.token === token);
  if (!inv || inv.usedAt) return null;
  if (inv.exp && inv.exp < nowMs()) return null;
  return inv;
}

function publicInvite(i) {
  return {
    id: i.id, email: i.email || null, role: i.role, exp: i.exp, createdAt: i.createdAt,
  };
}

// Issue a single-use invite link. role defaults to 'member'; email (optional)
// pins the invite to one address. Returns { invite, token }.
function createInvite({ email, role, ttlMs } = {}) {
  const db = load();
  if (!Array.isArray(db.invites)) db.invites = [];
  const token = crypto.randomBytes(24).toString('hex');
  const inv = {
    id: crypto.randomUUID(),
    token,
    email: email ? normEmail(email) : null,
    role: role === 'admin' ? 'admin' : 'member',
    exp: nowMs() + (ttlMs || INVITE_TTL_MS),
    createdAt: new Date().toISOString(),
    usedAt: null,
  };
  db.invites.push(inv);
  save(db);
  return { invite: publicInvite(inv), token };
}

function revokeInvite(id) {
  const db = load();
  if (!Array.isArray(db.invites)) return { ok: true };
  const before = db.invites.length;
  db.invites = db.invites.filter((i) => i.id !== id);
  if (db.invites.length !== before) save(db);
  return { ok: true };
}

function listInvites() {
  const db = load();
  if (!Array.isArray(db.invites)) return [];
  return db.invites
    .filter((i) => !i.usedAt && (!i.exp || i.exp >= nowMs()))
    .map(publicInvite);
}

// --- admin user management ---
function listUsers() {
  return load().users.map(publicUser);
}

// Admin creates a user directly with a chosen password (handed out of band).
function adminCreateUser({ email, password, role }) {
  if (!ENABLED) return { ok: false, error: 'accounts_disabled' };
  const e = normEmail(email);
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'invalid_email' };
  if (!password || String(password).length < 8) return { ok: false, error: 'weak_password' };
  const db = load();
  if (db.users.some((u) => u.email === e)) return { ok: false, error: 'email_taken' };
  const user = makeUser({ email: e, password, role });
  db.users.push(user);
  save(db);
  return { ok: true, user: publicUser(user) };
}

function setDisabled(id, disabled) {
  const db = load();
  const user = db.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'not_found' };
  // Never disable the last enabled admin (would lock everyone out).
  if (disabled && user.role === 'admin' && adminCount(db) <= 1) {
    return { ok: false, error: 'last_admin' };
  }
  user.disabled = !!disabled;
  save(db);
  return { ok: true, user: publicUser(user) };
}

function setRole(id, role) {
  const next = role === 'admin' ? 'admin' : 'member';
  const db = load();
  const user = db.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'not_found' };
  // Demoting the last admin would orphan the instance.
  if (next === 'member' && user.role === 'admin' && adminCount(db) <= 1) {
    return { ok: false, error: 'last_admin' };
  }
  user.role = next;
  save(db);
  return { ok: true, user: publicUser(user) };
}

function resetPassword(id, password) {
  if (!password || String(password).length < 8) return { ok: false, error: 'weak_password' };
  const db = load();
  const user = db.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'not_found' };
  user.salt = crypto.randomBytes(16).toString('hex');
  user.pwHash = hashPassword(password, user.salt);
  save(db);
  return { ok: true, user: publicUser(user) };
}

function deleteUser(id) {
  const db = load();
  const user = db.users.find((u) => u.id === id);
  if (!user) return { ok: false, error: 'not_found' };
  if (user.role === 'admin' && adminCount(db) <= 1) return { ok: false, error: 'last_admin' };
  db.users = db.users.filter((u) => u.id !== id);
  save(db);
  return { ok: true };
}

// Seed the deterministic root admin from env (ACCOUNTS_ADMIN_EMAIL/PASSWORD) the
// first time the instance boots with zero users. Idempotent: once ANY user
// exists this is a no-op, so it never clobbers a real password on redeploys.
// Returns a short status string for the startup log.
function bootstrap() {
  if (!ENABLED) return 'accounts disabled';
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return 'no ACCOUNTS_ADMIN_* set (first signup becomes admin)';
  if (count() > 0) return 'users already exist; root admin not re-seeded';
  if (String(ADMIN_PASSWORD).length < 8) return 'ACCOUNTS_ADMIN_PASSWORD too short (<8); skipped';
  const db = load();
  const user = makeUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin' });
  db.users.push(user);
  save(db);
  return `seeded root admin <${user.email}>`;
}

module.exports = {
  ENABLED,
  STRICT,
  SIGNUP_MODE,
  COOKIE,
  count,
  signupAllowed,
  signup,
  login,
  verifyToken,
  tokenFromReq,
  userFromReq,
  currentUser,
  adminFromReq,
  cookieHeader,
  clearCookieHeader,
  bootstrap,
  listUsers,
  adminCreateUser,
  setDisabled,
  setRole,
  resetPassword,
  deleteUser,
  createInvite,
  revokeInvite,
  listInvites,
};
