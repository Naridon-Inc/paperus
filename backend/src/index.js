// Version: 3.0.0 - Stateless signaling-only relay
//
// This backend is a tiny stateless Node WebSocket broker. It stores NOTHING:
// no database, no accounts, no JWT, no Stripe, no user/document data. It only
// brokers peer-to-peer connections:
//   - HTTP  GET  /health          liveness check
//   - WS         /signaling       zero-auth WebRTC pub/sub broker (the P2P core)
//   - WS         /yjs/:docName     OPTIONAL non-persisting Yjs relay (NAT fallback)
//
// The Yjs relay never touches a database — it only forwards CRDT/awareness
// updates between connected peers (RELAY_ONLY). E2EE docs are encrypted before
// they ever reach the server.
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const cors = require('cors');

const { PORT, ALLOWED_ORIGINS } = require('./config');
const logger = require('./logger');
const { setupWSConnection } = require('./yjs-handler');
const { setupSignalingConnection } = require('./signaling');
const analytics = require('./analytics');
const accounts = require('./accounts');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// First-party marketing-site analytics collector (see analytics.js for the
// privacy design: cookieless, no raw IP stored, DNT-honored, aggregate-only).
// Registered BEFORE the strict CORS gate because it's a write-only, no-credential
// public beacon that must accept cross-origin posts from the landing page; it
// sets its own permissive ACAO and returns no readable body. The client sends a
// text/plain body so it stays a CORS-"simple" request (no preflight).
app.options('/api/collect', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});
app.post('/api/collect', express.text({ type: '*/*', limit: '8kb' }), (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try { analytics.record(req, req.body ? JSON.parse(req.body) : {}); }
  catch (e) { /* ignore malformed beacons — never error a beacon */ }
  res.sendStatus(204);
});

// CORS Configuration.
//
// The self-hosted web app is served from the SAME origin as the relay (Caddy
// reverse-proxies /api, /signaling, /yjs to it), so a browser POST carries
// `Origin: https://<your-domain>`. We must accept that automatically on ANY
// self-host domain — otherwise sign-in POSTs 500 with an empty ALLOWED_ORIGINS
// (a same-origin GET sends no Origin, so it slips through, which is what made
// this easy to miss). We resolve options per-request so we can compare the
// Origin against the request's own Host (same-origin) without any config; the
// explicit ALLOWED_ORIGINS list still covers genuine cross-origin callers.
app.use(cors((req, callback) => {
  const host = req.headers.host;
  const reqOrigin = req.headers.origin;
  const sameOrigin = !!reqOrigin && !!host
    && (reqOrigin === `https://${host}` || reqOrigin === `http://${host}`);
  callback(null, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // non-browser / same-origin GET
      if (sameOrigin) return cb(null, true); // web app → its own relay, any domain
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });
}));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Aggregate analytics readout for the dashboard (stats.html). Token-gated via
// ANALYTICS_TOKEN; if no token is configured, only localhost may read. Same-origin
// (served from /public), so the global CORS gate below is fine for it.
app.get('/api/stats', (req, res) => {
  if (analytics.DISABLED) return res.status(404).json({ error: 'analytics disabled' });
  if (!analytics.authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  return res.json(analytics.aggregate({ days, includeBots: req.query.bots === '1' }));
});

// OPTIONAL accounts layer (see accounts.js). OFF unless ACCOUNTS_ENABLED=1.
// This is an access gate for a self-hosted WEB instance; it never holds any
// note-decryption key (notes stay E2EE regardless). /config is always public so
// the web app can discover whether to show a sign-in screen.
const jsonBody = express.json({ limit: '8kb' });

app.get('/api/account/config', (req, res) => {
  res.json({
    enabled: accounts.ENABLED,
    signupAllowed: accounts.signupAllowed(),
    strict: accounts.STRICT,
    hasUsers: accounts.count() > 0,
  });
});

app.post('/api/account/signup', jsonBody, (req, res) => {
  const r = accounts.signup(req.body || {});
  if (!r.ok) return res.status(r.error === 'accounts_disabled' ? 404 : 400).json({ error: r.error });
  res.set('Set-Cookie', accounts.cookieHeader(r.token));
  return res.json({ user: r.user, token: r.token });
});

app.post('/api/account/login', jsonBody, (req, res) => {
  const r = accounts.login(req.body || {});
  if (!r.ok) return res.status(r.error === 'accounts_disabled' ? 404 : 401).json({ error: r.error });
  res.set('Set-Cookie', accounts.cookieHeader(r.token));
  return res.json({ user: r.user, token: r.token });
});

app.post('/api/account/logout', (req, res) => {
  res.set('Set-Cookie', accounts.clearCookieHeader());
  res.sendStatus(204);
});

app.get('/api/account/me', (req, res) => {
  if (!accounts.ENABLED) return res.status(404).json({ error: 'accounts_disabled' });
  const u = accounts.currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  return res.json({ user: { id: u.id, email: u.email, role: u.role } });
});

// --- Admin management (super-admin only) -----------------------------------
// Every route below is gated on an enabled `admin` session. This is how a
// self-hosted instance is actually administered: list members, invite or create
// users (so a "closed" instance can grow past its first account), disable/delete,
// reset passwords, and promote/demote. Guard rails in accounts.js prevent locking
// out the last admin. None of this touches note content — still E2EE end to end.
function requireAdmin(req, res) {
  if (!accounts.ENABLED) { res.status(404).json({ error: 'accounts_disabled' }); return null; }
  const admin = accounts.adminFromReq(req);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return null; }
  return admin;
}

function originOf(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? `${proto}://${host}` : '';
}

app.get('/api/admin/users', (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  return res.json({ users: accounts.listUsers(), invites: accounts.listInvites() });
});

app.post('/api/admin/users', jsonBody, (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  const r = accounts.adminCreateUser(req.body || {});
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.json({ user: r.user });
});

app.post('/api/admin/invite', jsonBody, (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  const { email, role, ttlHours } = req.body || {};
  const ttlMs = ttlHours ? Math.max(1, Number(ttlHours)) * 3600 * 1000 : undefined;
  const r = accounts.createInvite({ email, role, ttlMs });
  const origin = originOf(req);
  const url = origin ? `${origin}/?invite=${r.token}` : `/?invite=${r.token}`;
  return res.json({ invite: r.invite, token: r.token, url });
});

app.post('/api/admin/revoke-invite', jsonBody, (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  accounts.revokeInvite((req.body || {}).id);
  return res.json({ ok: true });
});

app.post('/api/admin/disable', jsonBody, (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return undefined;
  const { id, disabled } = req.body || {};
  if (id === admin.id && disabled) return res.status(400).json({ error: 'cannot_disable_self' });
  const r = accounts.setDisabled(id, disabled);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.json({ user: r.user });
});

app.post('/api/admin/set-role', jsonBody, (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return undefined;
  const { id, role } = req.body || {};
  if (id === admin.id && role !== 'admin') return res.status(400).json({ error: 'cannot_demote_self' });
  const r = accounts.setRole(id, role);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.json({ user: r.user });
});

app.post('/api/admin/reset-password', jsonBody, (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  const { id, password } = req.body || {};
  const r = accounts.resetPassword(id, password);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.json({ user: r.user });
});

app.delete('/api/admin/users/:id', (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return undefined;
  if (req.params.id === admin.id) return res.status(400).json({ error: 'cannot_delete_self' });
  const r = accounts.deleteUser(req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.json({ ok: true });
});

// Static landing page (the public face of oss.naridon.com). This is purely
// presentational — the relay still stores nothing. The marketing page lives in
// /landing as the source of truth and is synced here via `npm run build:site`
// (root script). WebSocket upgrades (/signaling, /yjs) bypass Express entirely,
// so serving static files at / does not affect the P2P relay.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));

// WebSocket Handling
wss.on('connection', (conn, req) => {
  const url = req.url || '';

  // Strictly members-only instance: reject unauthenticated sync. Off by default
  // (ACCOUNTS_STRICT) so desktop peers on an open relay keep working; on, the web
  // app's session cookie rides the same-origin WS upgrade and is checked here.
  if (accounts.ENABLED && accounts.STRICT && !accounts.userFromReq(req)) {
    conn.close(1008, 'unauthorized');
    return;
  }

  if (url.startsWith('/yjs/')) {
    const parts = url.split('/yjs/')[1].split('?');
    const docName = parts[0];
    setupWSConnection(conn, req, { docName, gc: true });
    return;
  }

  if (url.startsWith('/signaling')) {
    setupSignalingConnection(conn, req);
    return;
  }

  conn.close();
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled promise rejection', { reason: String(reason) });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('server', 'Unhandled error', { path: req.path, error: err.message });
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

// Seed the deterministic root admin (ACCOUNTS_ADMIN_EMAIL/PASSWORD) on first boot
// so a fresh instance comes up with a known super-admin instead of an open
// "first signup wins admin" race. No-op once any user exists.
if (accounts.ENABLED) {
  try {
    logger.info('accounts', `bootstrap: ${accounts.bootstrap()}`);
  } catch (e) {
    logger.error('accounts', 'bootstrap failed', { error: e.message });
  }
}

server.listen(PORT, () => {
  logger.info('server', `Signaling relay running on port ${PORT}`);
});
