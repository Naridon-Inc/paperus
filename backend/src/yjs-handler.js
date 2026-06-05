// Non-persisting Yjs relay (NAT fallback).
//
// This is a PURE RELAY: it brokers realtime CRDT + awareness updates between
// connected peers but never persists anything (no database, no accounts) and
// never gates on auth. It exists only as a fallback transport when peers cannot
// reach each other directly over WebRTC. Content is the user's own — and E2EE
// docs are encrypted before they ever reach the server.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const logger = require('./logger');
const { PERSIST_DIR } = require('./config');

const docs = new Map();
const cleanupTimers = new Map();
const CLEANUP_DELAY = 30000;

const messageSync = 0;
const messageAwareness = 1;

// ─── Optional flat-file persistence (no database) ───
// When PERSIST_DIR is set, each room's full CRDT state lives in one binary file.
// This is the entire "cloud sync" storage layer: no DB, no schema, no accounts —
// just <hash>.ybin files holding E2EE ciphertext. Saves are debounced so a busy
// room writes at most ~once/second.
const SAVE_DEBOUNCE_MS = 1000;
if (PERSIST_DIR) {
  try { fs.mkdirSync(PERSIST_DIR, { recursive: true }); } catch (e) { logger.error('yjs', 'Cannot create persist dir', { error: e.message }); }
}
const docFile = (docName) => path.join(PERSIST_DIR, `${String(docName).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 200)}.ybin`);

const loadDoc = (doc, docName) => {
  if (!PERSIST_DIR) return;
  try {
    const file = docFile(docName);
    if (fs.existsSync(file)) {
      Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)));
      logger.debug('yjs', 'Loaded room from disk', { docName });
    }
  } catch (e) {
    logger.error('yjs', 'Failed to load room', { docName, error: e.message });
  }
};

const saveDoc = (doc, docName) => {
  if (!PERSIST_DIR) return;
  try {
    const file = docFile(docName);
    fs.writeFileSync(`${file}.tmp`, Buffer.from(Y.encodeStateAsUpdate(doc)));
    fs.renameSync(`${file}.tmp`, file); // atomic replace
  } catch (e) {
    logger.error('yjs', 'Failed to save room', { docName, error: e.message });
  }
};

const getDoc = (docName, gc = true) => {
  if (docs.has(docName)) {
    return docs.get(docName);
  }

  logger.debug('yjs', 'Initializing relay room', { docName });
  const doc = new Y.Doc({ gc });
  loadDoc(doc, docName);
  const awareness = new awarenessProtocol.Awareness(doc);
  const clients = new Set();
  let saveTimer = null;
  const scheduleSave = () => {
    if (!PERSIST_DIR || saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveDoc(doc, docName); }, SAVE_DEBOUNCE_MS);
  };

  const send = (conn, m) => {
    if (conn.readyState !== WebSocket.OPEN) {
      clients.delete(conn);
      return;
    }
    try { conn.send(m); } catch (e) { clients.delete(conn); }
  };

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const buff = encoding.toUint8Array(encoder);
    clients.forEach((client) => {
      if (client !== origin) send(client, buff);
    });
    scheduleSave(); // persist the new (ciphertext) state if PERSIST_DIR is set
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
    encoding.writeVarUint8Array(encoder, update);
    const buff = encoding.toUint8Array(encoder);
    clients.forEach((client) => {
      if (client !== origin) send(client, buff);
    });
  });

  const entry = { doc, awareness, clients };
  docs.set(docName, entry);
  return entry;
};

const setupWSConnection = (conn, req, { docName, gc = true } = {}) => {
  docName = (docName || '').split('?')[0].replace(/\/$/, '');
  if (!docName) {
    const url = new URL(req.url, 'http://localhost');
    docName = url.pathname.split('/').pop().split('?')[0];
  }
  if (!docName) {
    conn.close(1008, 'Missing room');
    return;
  }
  logger.debug('yjs', 'New relay connection', { docName });
  conn.binaryType = 'arraybuffer';

  // Pure relay: anyone who knows the (UUID/hashed) room may sync.
  const { doc, awareness, clients } = getDoc(docName, gc);

  if (cleanupTimers.has(docName)) {
    clearTimeout(cleanupTimers.get(docName));
    cleanupTimers.delete(docName);
  }

  clients.add(conn);

  const handleMessage = (message) => {
    try {
      const encoder = encoding.createEncoder();
      const decoder = decoding.createDecoder(new Uint8Array(message));
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync:
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
          if (encoding.length(encoder) > 1) {
            if (conn.readyState === WebSocket.OPEN) conn.send(encoding.toUint8Array(encoder));
          }
          break;
        case messageAwareness:
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), conn);
          break;
        default:
          break;
      }
    } catch (err) {
      logger.error('yjs', 'Message processing error', { docName, error: err.message });
    }
  };

  conn.on('message', handleMessage);

  // Initial sync handshake
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  if (conn.readyState === WebSocket.OPEN) conn.send(encoding.toUint8Array(encoder));

  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoderAwareness = encoding.createEncoder();
    encoding.writeVarUint(encoderAwareness, messageAwareness);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys()));
    encoding.writeVarUint8Array(encoderAwareness, update);
    if (conn.readyState === WebSocket.OPEN) conn.send(encoding.toUint8Array(encoderAwareness));
  }

  conn.on('close', () => {
    clients.delete(conn);
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], null);
    if (clients.size === 0) {
      const timer = setTimeout(() => {
        cleanupTimers.delete(docName);
        const entry = docs.get(docName);
        if (!entry) return;
        if (entry.clients.size === 0) {
          logger.debug('yjs', 'Cleaning up relay room', { docName });
          saveDoc(entry.doc, docName); // final flush so the latest state survives
          entry.awareness.destroy();
          entry.doc.destroy();
          docs.delete(docName);
        }
      }, CLEANUP_DELAY);
      cleanupTimers.set(docName, timer);
    }
  });
};

module.exports = { setupWSConnection };
