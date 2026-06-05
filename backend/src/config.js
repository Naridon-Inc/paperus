require('dotenv').config();
// Centralized configuration for the stateless signaling-only relay.
// No database, no auth secrets, no billing — this server stores nothing.

const isProduction = process.env.NODE_ENV === 'production';

const PORT = parseInt(process.env.PORT, 10) || 9008;

// Self-hosters set ALLOWED_ORIGINS (comma-separated) to their own domain(s).
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : []),
  ...(isProduction
    ? []
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:8080', 'http://localhost:9008']),
];

// OPTIONAL always-on persistence. Unset by default → the relay stays purely
// in-memory and stores nothing (a room is forgotten ~30s after the last peer
// leaves). Set YJS_PERSIST_DIR to a folder and the /yjs relay keeps each room's
// state in one binary file there, so a self-hosted box can serve the latest note
// even when no human is online. It only ever stores E2EE ciphertext keyed by the
// hashed room name — never accounts, keys, or plaintext.
const PERSIST_DIR = process.env.YJS_PERSIST_DIR || null;

module.exports = {
  PORT,
  ALLOWED_ORIGINS,
  isProduction,
  PERSIST_DIR,
};
