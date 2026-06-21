/**
 * Calendar subsystem — account config + secure password persistence.
 *
 * Account CONFIG (name/email/provider/server/color) lives in the sqlite
 * `accounts` table (via Store). The account PASSWORD (a CalDAV app-specific
 * password) is the only secret; it is encrypted at rest with Electron
 * `safeStorage` and stored, base64, in the `meta` table under key
 * `secure_cal_pw_<accountId>`.
 *
 * SECURITY: the decrypted password never crosses IPC and is never logged. Only
 * the main process ever sees plaintext, and only transiently when building a
 * CalDAV (tsdav) config. If the OS secure-storage backend is unavailable we
 * REFUSE to add an account (so a password could never be written in the clear).
 *
 * Mirrors src/main/email/accounts.js, scoped to calendar and kept entirely in
 * the main process — there is no `calendar:secure-*` IPC surface.
 */

import { safeStorage } from 'electron'
import crypto from 'crypto'
import { Store } from './store.js'

const PW_KEY_PREFIX = 'secure_cal_pw_'

/** Generate a collision-resistant account id (not derived from email). */
export function newAccountId() {
  return `cal_${crypto.randomBytes(9).toString('hex')}`
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
 * Returns the stored account id.
 *
 * config = { name, email, provider, server, color }  (password handled
 *            separately via saveSecurePassword).
 */
export function persistAccountConfig(accountId, config) {
  const c = config || {}
  Store.upsertAccount({
    id: accountId,
    name: c.name ?? null,
    email: c.email ?? c.username ?? null,
    provider: c.provider ?? 'generic',
    server: c.server ?? null,
    color: c.color ?? null,
    created_ts: Date.now(),
  })
  return accountId
}

/**
 * Build the CalDAV (tsdav) config for an account, including the decrypted
 * password. INTERNAL ONLY — never hand the result to IPC. Returns null if the
 * account or its password is missing.
 *
 * Shape matches the tsdav DAVClient constructor:
 *   { serverUrl, credentials: { username, password } }
 * The username is the account's stored `email` (CalDAV servers authenticate on
 * the full address/Apple-ID; we persist that as `email`).
 */
export function buildDavConfig(accountId) {
  const row = Store.getAccount(accountId)
  if (!row) return null
  const password = getSecurePassword(accountId)
  if (password == null) return null
  return {
    id: row.id,
    serverUrl: row.server,
    provider: row.provider,
    credentials: {
      username: row.email,
      password,
    },
  }
}

/**
 * Build a renderer-safe account object (NO password) for the accounts list.
 */
export function publicAccount(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    provider: row.provider,
    server: row.server,
    color: row.color,
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
