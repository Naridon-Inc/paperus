# Paperus Signaling Relay

A tiny **stateless** Node WebSocket broker for Paperus's zero-account, pure-P2P
model. It **stores nothing** — no database, no accounts, no JWT, no billing, no
user or document data. It only brokers peer connections.

## Endpoints

- `GET /health` — liveness check (`{ "status": "ok" }`).
- `WS  /signaling` — zero-auth WebRTC pub/sub broker (the P2P core). Peers
  subscribe/publish to `notionless-<hash>` topics; the relay only forwards
  messages between subscribers and never inspects or stores them.
- `WS  /yjs/:docName` — optional non-persisting Yjs relay used as a NAT fallback
  when peers cannot reach each other directly. Forwards CRDT + awareness updates
  in memory only; nothing is persisted. E2EE docs are encrypted before they
  reach the server.

## Setup

```bash
cd backend
npm install   # or: pnpm install
npm start     # production
npm run dev   # nodemon
```

The server runs on `http://localhost:9008` by default (override with `PORT`).

## Configuration

See `.env.example`. Only relay-relevant vars exist:

- `PORT` — listen port (default `9008`).
- `NODE_ENV` — `development` | `production`.
- `ALLOWED_ORIGINS` — comma-separated allowed web origins for CORS.

## Architecture

- `src/index.js` — entry point: HTTP `/health` + WebSocket routing.
- `src/signaling.js` — the WebRTC signaling pub/sub broker.
- `src/yjs-handler.js` — non-persisting Yjs relay (NAT fallback).
- `src/config.js` — environment configuration.
- `src/logger.js` — structured JSON logging.
