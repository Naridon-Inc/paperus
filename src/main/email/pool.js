/**
 * Email subsystem — IMAP connection pool.
 *
 * One lazily-created, cached `ImapFlow` connection per account (keyed by
 * accountId in a Map). `getConnection(accountId)` builds the config from the
 * account row + decrypted password (via accounts.js) and connects, with capped
 * exponential-backoff retry. TLS is mandatory (`secure:true`) with
 * `rejectUnauthorized:true`; the ImapFlow logger is disabled so credentials and
 * message contents never hit a log.
 *
 * `withLock(accountId, folder, fn)` wraps ImapFlow's `getMailboxLock` so callers
 * can safely select a mailbox and run a body of work; the lock is always
 * released. `closeAll()` logs out every connection (called on app quit).
 *
 * The decrypted password lives only inside the ImapFlow client config object in
 * main-process memory — it is never returned, serialized, or logged here.
 */

// imapflow is CommonJS — default-import then destructure (a named ESM import of
// `ImapFlow` is unresolvable once the dep is externalized in the main build).
import imapflow from 'imapflow'

const { ImapFlow } = imapflow
import { buildConnectionConfig } from './accounts.js'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 15000

// accountId -> { client, connectingPromise }
const pool = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeClient(cfg) {
  return new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.secure !== false, // implicit TLS (993). STARTTLS handled by lib when secure:false.
    auth: {
      user: cfg.auth.user,
      pass: cfg.auth.pass,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    logger: false,
    // Be tolerant of servers with quirky qresync/condstore; we don't rely on it.
    qresync: false,
    clientInfo: {
      name: 'Paperus',
    },
    // Reasonable socket timeouts so a dead connection doesn't hang the app.
    socketTimeout: 60_000,
    greetingTimeout: 20_000,
    connectionTimeout: 20_000,
  })
}

/**
 * Get a live, authenticated ImapFlow connection for an account, creating and
 * caching one if needed. Reuses an in-flight connect. Throws on persistent
 * failure (callers wrap in try/catch and convert to `{ok:false}`).
 */
export async function getConnection(accountId) {
  if (!accountId) throw new Error('accountId required')

  const existing = pool.get(accountId)
  if (existing) {
    if (existing.connectingPromise) {
      await existing.connectingPromise
    }
    const client = existing.client
    if (client && client.usable) return client
    // Stale/closed — drop and rebuild below.
    pool.delete(accountId)
    try { await client?.logout() } catch (_e) { /* noop */ }
  }

  const cfg = buildConnectionConfig(accountId)
  if (!cfg) throw new Error('account config or password missing')
  if (!cfg.imap.host) throw new Error('IMAP host not configured')

  const entry = { client: null, connectingPromise: null }
  pool.set(accountId, entry)

  entry.connectingPromise = connectWithBackoff(cfg)
  try {
    const client = await entry.connectingPromise
    entry.client = client
    entry.connectingPromise = null

    // If the server drops us, evict from the pool so the next call reconnects.
    const evict = () => {
      const cur = pool.get(accountId)
      if (cur && cur.client === client) pool.delete(accountId)
    }
    client.on('close', evict)
    client.on('error', () => { /* swallow; eviction happens on close */ })

    return client
  } catch (err) {
    pool.delete(accountId)
    throw err
  }
}

async function connectWithBackoff(cfg) {
  let lastErr = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const client = makeClient(cfg)
    // Prevent unhandled 'error' events from crashing the process before connect.
    client.on('error', () => {})
    try {
      await client.connect()
      return client
    } catch (err) {
      lastErr = err
      try { await client.logout() } catch (_e) { /* noop */ }
      try { client.close() } catch (_e) { /* noop */ }
      if (attempt === MAX_RETRIES) break
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
      // Jitter to avoid thundering-herd reconnects.
      await sleep(delay + Math.floor(Math.random() * 250))
    }
  }
  throw lastErr || new Error('IMAP connection failed')
}

/**
 * Run `fn(lock)` with an exclusive mailbox lock on `folder`. The mailbox is
 * opened by getMailboxLock; the lock is ALWAYS released. `opts` is passed
 * through to getMailboxLock (e.g. `{ readonly:true }`).
 */
export async function withLock(accountId, folder, fn, opts = {}) {
  const client = await getConnection(accountId)
  const lock = await client.getMailboxLock(folder, opts)
  try {
    return await fn(client, lock)
  } finally {
    try { lock.release() } catch (_e) { /* noop */ }
  }
}

/** Get a connection without locking a mailbox (for list/status/append). */
export async function getClient(accountId) {
  return getConnection(accountId)
}

/** Close + forget a single account's connection. */
export async function closeConnection(accountId) {
  const entry = pool.get(accountId)
  if (!entry) return
  pool.delete(accountId)
  const client = entry.client
  if (client) {
    try { await client.logout() } catch (_e) {
      try { client.close() } catch (_e2) { /* noop */ }
    }
  }
}

/** Log out + forget every connection (call on app quit). */
export async function closeAll() {
  const entries = [...pool.entries()]
  pool.clear()
  await Promise.all(entries.map(async ([, entry]) => {
    const client = entry.client
    if (client) {
      try { await client.logout() } catch (_e) {
        try { client.close() } catch (_e2) { /* noop */ }
      }
    }
  }))
}
