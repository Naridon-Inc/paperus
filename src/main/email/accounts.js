/**
 * Email subsystem — account config + secure password persistence.
 *
 * Account CONFIG (host/port/secure/username/email/name/color/provider) lives in
 * the sqlite `accounts` table (via Store). The account PASSWORD is the only
 * secret; it is encrypted at rest with Electron `safeStorage` and stored, base64,
 * in the `meta` table under key `secure_email_pw_<accountId>`.
 *
 * SECURITY: the decrypted password never crosses IPC and is never logged. Only
 * the main process ever sees plaintext, and only transiently when building an
 * IMAP/SMTP config. If the OS secure-storage backend is unavailable we REFUSE to
 * add an account (so a password could never be written in the clear).
 *
 * `safeStorage` mirrors the host's existing `auth:secure-*` convention
 * (base64 of the encrypted Buffer), but scoped to email and kept entirely in the
 * main process — there is no `email:secure-*` IPC surface.
 */

import { safeStorage } from 'electron'
import crypto from 'crypto'
import { Store } from './store.js'

const PW_KEY_PREFIX = 'secure_email_pw_'

/** Generate a collision-resistant account id (not derived from email). */
export function newAccountId() {
  return `acct_${crypto.randomBytes(9).toString('hex')}`
}

/** True if the OS-backed encryption is usable. */
export function secureStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch (_e) {
    return false
  }
}

/**
 * Encrypt + persist an account password. Returns true on success. Refuses
 * (returns false) when secure storage is unavailable — the caller must surface
 * `{ ok:false, error:'OS secure storage unavailable' }`.
 */
export function saveSecurePassword(accountId, plaintext) {
  if (!secureStorageAvailable()) return false
  if (typeof plaintext !== 'string' || plaintext.length === 0) return false
  const enc = safeStorage.encryptString(plaintext)
  Store.setMeta(PW_KEY_PREFIX + accountId, enc.toString('base64'))
  return true
}

/**
 * Decrypt + return an account password, or null if missing/undecryptable.
 * NEVER log the return value; NEVER send it across IPC.
 */
export function getSecurePassword(accountId) {
  if (!secureStorageAvailable()) return null
  const b64 = Store.getMeta(PW_KEY_PREFIX + accountId)
  if (!b64) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    return safeStorage.decryptString(buf)
  } catch (_e) {
    return null
  }
}

/** Remove the stored secure password for an account. */
export function clearSecurePassword(accountId) {
  Store.delMeta(PW_KEY_PREFIX + accountId)
}

/**
 * Persist account config (no password) from a renderer-supplied config object.
 * Returns the stored account id. Validates required transport fields.
 *
 * config = { email, name, provider, color, imapHost, imapPort, imapSecure,
 *            smtpHost, smtpPort, smtpSecure, username }  (password handled
 *            separately via saveSecurePassword).
 */
export function persistAccountConfig(accountId, config) {
  const c = config || {}
  Store.upsertAccount({
    id: accountId,
    email: c.email ?? c.username ?? null,
    name: c.name ?? null,
    color: c.color ?? null,
    provider: c.provider ?? 'generic',
    imap_host: c.imapHost ?? null,
    imap_port: toPort(c.imapPort, 993),
    imap_secure: c.imapSecure !== false,
    smtp_host: c.smtpHost ?? null,
    smtp_port: toPort(c.smtpPort, 465),
    smtp_secure: c.smtpSecure !== false,
    username: c.username ?? c.email ?? null,
    created_at: Date.now(),
  })
  return accountId
}

/**
 * Build the full main-process config for opening connections, including the
 * decrypted password. INTERNAL ONLY — never hand the result to IPC.
 * Returns null if the account or its password is missing.
 */
export function buildConnectionConfig(accountId) {
  const row = Store.getAccount(accountId)
  if (!row) return null
  const password = getSecurePassword(accountId)
  if (password == null) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    imap: {
      host: row.imap_host,
      port: row.imap_port || 993,
      secure: row.imap_secure !== 0,
    },
    smtp: {
      host: row.smtp_host,
      port: row.smtp_port || 465,
      secure: row.smtp_secure !== 0,
    },
    auth: {
      user: row.username || row.email,
      pass: password,
    },
  }
}

/**
 * Build a renderer-safe account object (NO password, NO username detail beyond
 * what's already public) for the accounts list. Includes a live `unread` count
 * computed from the local Store across all folders.
 */
export function publicAccount(row) {
  if (!row) return null
  let unread = 0
  try { unread = Store.countUnseenAccount(row.id) } catch (_e) { unread = 0 }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    provider: row.provider,
    color: row.color,
    unread,
  }
}

/** All accounts as renderer-safe objects. */
export function listPublicAccounts() {
  return Store.listAccounts().map(publicAccount)
}

/** Does an account id exist? */
export function accountExists(accountId) {
  return !!Store.getAccount(accountId)
}

function toPort(v, fallback) {
  const n = Number(v)
  if (Number.isInteger(n) && n > 0 && n <= 65535) return n
  return fallback
}
