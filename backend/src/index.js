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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// CORS Configuration
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

server.listen(PORT, () => {
  logger.info('server', `Signaling relay running on port ${PORT}`);
});
