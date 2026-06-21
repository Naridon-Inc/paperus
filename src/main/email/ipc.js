/**
 * Email subsystem — IPC surface. `registerEmailIpc(app, { getMainWindow })`.
 *
 * Registers every `email:*` channel from the renderer contract. Conventions
 * inherited from the host (see plugin-studio/studio-manager.js):
 *  - Idempotent (`_registered` guard); never throws at import or registration.
 *  - EVERY handler is wrapped try/catch and returns a JSON-serializable
 *    `{ ok:true, ... }` / `{ ok:false, error:string }` — never throws across IPC.
 *  - Push events ride the existing `message` channel:
 *      webContents.send('message', 'email:new',          { accountId, folder, count })
 *      webContents.send('message', 'email:syncProgress', { accountId, folder, count })
 *
 * SECURITY:
 *  - The decrypted account password never crosses IPC and is never logged.
 *  - Adding an account is refused if OS secure storage is unavailable.
 *  - Attachment saves go through the OS save dialog and writes are confined to
 *    the directory the user picked.
 */

import { ipcMain, dialog } from 'electron'
import path from 'path'

import { Store } from './store.js'
import * as accounts from './accounts.js'
import * as imap from './imap.js'
import * as smtp from './smtp.js'
import { closeAll as closeAllImap, closeConnection } from './pool.js'

let _registered = false
let _getMainWindow = () => null
let _pollTimer = null
// How often the main process re-checks each account's Inbox for new mail so the
// client stays live without the user clicking. Cheap: incremental UID sync.
const POLL_MS = 90 * 1000

function ok(extra = {}) {
  return { ok: true, ...extra }
}

function fail(err) {
  const msg = err && err.message ? err.message : (typeof err === 'string' ? err : 'email error')
  return { ok: false, error: msg }
}

function send(channel, payload) {
  try {
    const win = _getMainWindow()
    if (win && win.webContents && !win.webContents.isDestroyed?.()) {
      win.webContents.send('message', channel, payload)
    }
  } catch (_e) { /* noop */ }
}

// ---- shape helpers (Store row -> renderer message summary) ------------------
function rowToSummary(row) {
  return {
    uid: row.uid,
    from: { name: row.from_name || '', address: row.from_addr || '' },
    to: row.to_addrs || '',
    subject: row.subject || '',
    date: row.date_ts || null,
    seen: !!row.seen,
    flagged: !!row.flagged,
    hasAttachments: !!row.has_attachments,
    snippet: row.snippet || '',
  }
}

function requireAccount(accountId) {
  if (!accountId || !accounts.accountExists(accountId)) {
    throw new Error('unknown account')
  }
}

// ---- handlers ---------------------------------------------------------------

async function handleAccountsList() {
  return ok({ accounts: accounts.listPublicAccounts() })
}

async function handleAccountTest(args) {
  const config = args && args.config
  if (!config) return fail('missing config')
  if (!accounts.secureStorageAvailable()) return fail('OS secure storage unavailable')
  if (!config.imapHost || !config.smtpHost) return fail('IMAP and SMTP host required')

  // Verify IMAP by opening an ad-hoc connection, then SMTP via nodemailer.verify.
  const { ImapFlow } = await import('imapflow')
  const imapClient = new ImapFlow({
    host: config.imapHost,
    port: Number(config.imapPort) || 993,
    secure: config.imapSecure !== false,
    auth: { user: config.username || config.email, pass: config.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
  })
  try {
    await imapClient.connect()
  } catch (e) {
    try { imapClient.close() } catch (_e) { /* noop */ }
    return fail(`IMAP: ${e && e.message ? e.message : 'connection failed'}`)
  }
  try { await imapClient.logout() } catch (_e) {
    try { imapClient.close() } catch (_e2) { /* noop */ }
  }

  try {
    await smtp.verifyConfig(config)
  } catch (e) {
    return fail(`SMTP: ${e && e.message ? e.message : 'verification failed'}`)
  }

  return ok()
}

async function handleAccountAdd(args) {
  const config = args && args.config
  if (!config) return fail('missing config')
  if (!accounts.secureStorageAvailable()) return fail('OS secure storage unavailable')
  if (!config.imapHost || !config.smtpHost) return fail('IMAP and SMTP host required')
  if (!config.password) return fail('password required')

  const accountId = accounts.newAccountId()

  // Persist the secure password FIRST; if that fails (storage unavailable mid-
  // flight) we never write a usable account.
  const savedPw = accounts.saveSecurePassword(accountId, config.password)
  if (!savedPw) return fail('OS secure storage unavailable')

  try {
    accounts.persistAccountConfig(accountId, config)
  } catch (e) {
    accounts.clearSecurePassword(accountId)
    return fail(e && e.message ? e.message : 'failed to persist account')
  }

  // Kick an initial folder list + INBOX sync in the background. Errors here are
  // surfaced via the email:syncProgress channel, not the add response.
  void bootstrapAccount(accountId)

  return ok({ accountId })
}

// Special-use mailboxes a proper client keeps populated, in display priority.
const STANDARD_SPECIAL_USE = ['Inbox', 'Sent', 'Drafts', 'Junk', 'Trash', 'Archive']

// Sync one folder and emit the usual progress/new events. Best-effort: returns
// newCount (0 on error) and never throws — so a single bad folder can't abort a
// multi-folder pass.
async function syncOneFolder(accountId, folderPath) {
  try {
    const { newCount } = await imap.syncFolder(accountId, folderPath, {
      onProgress: (p) => send('email:syncProgress', p),
    })
    if (newCount > 0) send('email:new', { accountId, folder: folderPath, count: newCount })
    return newCount
  } catch (e) {
    send('email:syncProgress', { accountId, folder: folderPath, phase: 'error', error: e && e.message ? e.message : 'sync failed' })
    return 0
  }
}

// List folders, then sync the standard mailboxes (Inbox first) so Sent, Drafts,
// Spam, Trash and Archive all have content — not just the Inbox. Serial to avoid
// hammering the server / tripping per-account connection caps.
async function syncStandardFolders(accountId) {
  const folders = await imap.listFolders(accountId)
  send('email:syncProgress', { accountId, folder: null, phase: 'folders', count: folders.length })
  const picked = []
  for (const u of STANDARD_SPECIAL_USE) {
    const f = folders.find((x) => x.specialUse === u)
    if (f && !picked.includes(f.path)) picked.push(f.path)
  }
  // Always include a literal INBOX even if the server advertised no special-use.
  if (!picked.length) {
    const inbox = folders.find((f) => /^inbox$/i.test(f.path)) || folders[0]
    if (inbox) picked.push(inbox.path)
  }
  for (const p of picked) await syncOneFolder(accountId, p)
  return picked
}

async function bootstrapAccount(accountId) {
  try {
    await syncStandardFolders(accountId)
  } catch (e) {
    send('email:syncProgress', {
      accountId, folder: null, phase: 'error', error: e && e.message ? e.message : 'sync failed',
    })
  }
}

async function handleAccountUpdate(args) {
  const id = args && args.id
  const patch = (args && args.patch) || {}
  requireAccount(id)

  const row = Store.getAccount(id)
  // Merge editable config fields (NOT the id/created_at). Password handled below.
  const merged = {
    email: patch.email ?? row.email,
    name: patch.name ?? row.name,
    provider: patch.provider ?? row.provider,
    color: patch.color ?? row.color,
    imapHost: patch.imapHost ?? row.imap_host,
    imapPort: patch.imapPort ?? row.imap_port,
    imapSecure: patch.imapSecure ?? (row.imap_secure !== 0),
    smtpHost: patch.smtpHost ?? row.smtp_host,
    smtpPort: patch.smtpPort ?? row.smtp_port,
    smtpSecure: patch.smtpSecure ?? (row.smtp_secure !== 0),
    username: patch.username ?? row.username,
  }
  accounts.persistAccountConfig(id, merged)

  // If a new password was provided, re-encrypt it.
  if (typeof patch.password === 'string' && patch.password.length) {
    if (!accounts.saveSecurePassword(id, patch.password)) {
      return fail('OS secure storage unavailable')
    }
  }

  // Drop cached connections so the next op rebuilds with new config/credentials.
  await closeConnection(id).catch(() => {})
  smtp.closeTransport(id)

  return ok()
}

async function handleAccountRemove(args) {
  const id = args && args.id
  requireAccount(id)
  await closeConnection(id).catch(() => {})
  smtp.closeTransport(id)
  accounts.clearSecurePassword(id)
  Store.removeAccount(id) // wipes folders/messages/bodies/attachments + meta
  return ok()
}

async function handleFolders(args) {
  const accountId = args && args.accountId
  requireAccount(accountId)
  let folders
  try {
    folders = await imap.listFolders(accountId)
  } catch (_e) {
    // Offline: serve the cached folder list from the Store.
    folders = Store.listFolders(accountId).map((f) => ({
      path: f.path,
      name: f.name,
      specialUse: f.special_use,
      unread: f.unseen != null ? f.unseen : Store.countUnseen(accountId, f.path),
      total: f.total != null ? f.total : Store.countMessages(accountId, f.path),
    }))
  }
  return ok({ folders })
}

async function handleFolderSync(args) {
  const accountId = args && args.accountId
  const folder = args && args.folder
  // Unified-inbox sentinel: sync every account's Inbox so the merged view stays
  // live. (Renderer sends accountId '*' / folder '__ALL_INBOXES__'.)
  if (accountId === '*' || folder === '__ALL_INBOXES__') {
    const pub = accounts.listPublicAccounts()
    let newCount = 0
    for (const a of pub) newCount += await syncOneFolder(a.id, resolveInboxFolder(a.id))
    return ok({ newCount })
  }
  requireAccount(accountId)
  if (!folder) return fail('folder required')
  try {
    const res = await imap.syncFolder(accountId, folder, { onProgress: (p) => send('email:syncProgress', p) })
    const newCount = (res && res.newCount) || 0
    if (newCount > 0) send('email:new', { accountId, folder, count: newCount })
    return ok({ newCount })
  } catch (e) {
    const error = String((e && e.message) || e)
    send('email:syncProgress', { accountId, folder, phase: 'error', error })
    return ok({ newCount: 0, error })
  }
}

// Background body prefetch for a folder (or every Inbox when unified). Detached —
// returns immediately; the cache fills behind the scenes so opening is instant.
async function handlePrefetch(args) {
  const accountId = args && args.accountId
  const limit = args && args.limit
  if (!accountId || accountId === '*') {
    const pub = accounts.listPublicAccounts()
    for (const a of pub) void imap.prefetchBodies(a.id, resolveInboxFolder(a.id), { limit }).catch(() => {})
    return ok({ started: pub.length })
  }
  requireAccount(accountId)
  const folder = (args && args.folder) || resolveInboxFolder(accountId)
  void imap.prefetchBodies(accountId, folder, { limit }).catch(() => {})
  return ok({ started: 1 })
}

// Resolve an account's Inbox folder path from the cached folder list (special-use
// Inbox, else a literal "INBOX", else the first known folder).
function resolveInboxFolder(accountId) {
  const cached = Store.listFolders(accountId) || []
  const inbox = cached.find((f) => /inbox/i.test(f.special_use || ''))
    || cached.find((f) => /^inbox$/i.test(f.path || ''))
  return inbox ? inbox.path : 'INBOX'
}

// Unified inbox: every account's Inbox merged, newest-first. Each row carries a
// composite `uid` (globally unique for list keying/keyboard nav) plus the real
// `ruid`/`accountId`/`folder` so the renderer can target the right mailbox for
// open/flag/move/delete.
async function handleMessagesUnified(args) {
  const offset = Number(args.offset) || 0
  const limit = Number(args.limit) || 50
  const pub = accounts.listPublicAccounts()
  const meta = {}
  for (const a of pub) meta[a.id] = { email: a.email, color: a.color }
  const inboxes = pub.map((a) => ({ accountId: a.id, folder: resolveInboxFolder(a.id) }))
  if (!inboxes.length) return ok({ messages: [], total: 0 })
  const rows = Store.listMessagesUnified({ inboxes, offset, limit })
  const total = Store.countMessagesUnified(inboxes)
  const messages = rows.map((r) => ({
    ...rowToSummary(r),
    uid: `${r.account_id}::${r.folder}::${r.uid}`,
    ruid: r.uid,
    accountId: r.account_id,
    folder: r.folder,
    accountEmail: meta[r.account_id] ? meta[r.account_id].email : undefined,
    accountColor: meta[r.account_id] ? meta[r.account_id].color : undefined,
  }))
  return ok({ messages, total })
}

async function handleMessages(args) {
  const accountId = args && args.accountId
  const folder = args && args.folder
  // '*' = the unified "All inboxes" pseudo-account (not a real account row).
  if (accountId === '*') return handleMessagesUnified(args)
  requireAccount(accountId)
  if (!folder) return fail('folder required')
  const offset = Number(args.offset) || 0
  const limit = Number(args.limit) || 50
  const rows = Store.listMessages({ accountId, folder, offset, limit })
  const total = Store.countMessages(accountId, folder)
  return ok({ messages: rows.map(rowToSummary), total })
}

async function handleMessage(args) {
  const accountId = args && args.accountId
  const folder = args && args.folder
  const uid = args && args.uid
  requireAccount(accountId)
  if (!folder || uid == null) return fail('folder and uid required')
  const message = await imap.getMessage(accountId, folder, uid)
  return ok({ message })
}

async function handleMarkRead(args) {
  const { accountId, folder, uid, seen } = args || {}
  requireAccount(accountId)
  if (!folder || uid == null) return fail('folder and uid required')
  await imap.setSeen(accountId, folder, uid, !!seen)
  return ok()
}

async function handleFlag(args) {
  const { accountId, folder, uid, flagged } = args || {}
  requireAccount(accountId)
  if (!folder || uid == null) return fail('folder and uid required')
  await imap.setFlagged(accountId, folder, uid, !!flagged)
  return ok()
}

async function handleMove(args) {
  const { accountId, folder, uid, toFolder } = args || {}
  requireAccount(accountId)
  if (!folder || uid == null || !toFolder) return fail('folder, uid and toFolder required')
  await imap.move(accountId, folder, uid, toFolder)
  return ok()
}

async function handleDelete(args) {
  const { accountId, folder, uid } = args || {}
  requireAccount(accountId)
  if (!folder || uid == null) return fail('folder and uid required')
  await imap.deleteMessage(accountId, folder, uid)
  return ok()
}

async function handleAttachmentSave(args) {
  const { accountId, folder, uid, partId, filename } = args || {}
  requireAccount(accountId)
  if (!folder || uid == null || partId == null) return fail('folder, uid and partId required')

  // Confirm the attachment exists in our metadata (so partId is real).
  const meta = Store.getAttachmentMeta(accountId, folder, uid, partId)
  const safeName = sanitizeFilename(filename || (meta && meta.filename) || `attachment-${partId}`)

  const win = _getMainWindow()
  const result = await dialog.showSaveDialog(win || undefined, {
    title: 'Save attachment',
    defaultPath: safeName,
  })
  if (result.canceled || !result.filePath) return fail('canceled')

  // Confine the write: the final path must live inside the directory the user
  // chose, and the basename must not traverse.
  const chosenDir = path.dirname(path.resolve(result.filePath))
  const finalPath = path.join(chosenDir, path.basename(result.filePath))
  if (path.dirname(finalPath) !== chosenDir) return fail('invalid save path')

  const savedPath = await imap.saveAttachment(accountId, folder, uid, partId, finalPath)
  return ok({ savedPath })
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[/\\]+/g, '_')
    .replace(/[\x00-\x1f<>:"|?*]+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 255) || 'attachment'
}

async function handleSend(args) {
  const accountId = args && args.accountId
  const draft = (args && args.draft) || {}
  requireAccount(accountId)
  if (!draft.to || (Array.isArray(draft.to) && draft.to.length === 0)) {
    return fail('at least one recipient required')
  }
  const { messageId } = await smtp.sendMail(accountId, draft)
  return ok({ messageId })
}

async function handleSearch(args) {
  const accountId = args && args.accountId
  const query = args && args.query
  const folder = args && args.folder
  requireAccount(accountId)
  if (!query || !String(query).trim()) return ok({ messages: [] })

  let rows
  if (folder) {
    rows = await imap.searchFolder(accountId, folder, query)
  } else {
    // No folder → local LIKE search across everything we've cached.
    rows = Store.searchMessages(accountId, query, null)
  }
  return ok({ messages: rows.map(rowToSummary) })
}

// ---- registration -----------------------------------------------------------

/**
 * Register all email:* IPC handlers. Idempotent and import-safe.
 *
 * @param {import('electron').App} app
 * @param {{ getMainWindow?: () => import('electron').BrowserWindow|null }} opts
 */
export function registerEmailIpc(app, opts = {}) {
  if (_registered) return
  _registered = true
  _getMainWindow = (opts && typeof opts.getMainWindow === 'function')
    ? opts.getMainWindow
    : () => null

  // Open the DB up front so the first IPC call is fast. Defensive: never throw.
  try {
    Store.init(app)
  } catch (e) {
    console.warn('[EmailIpc] Store init failed; email disabled:', e && e.message)
    return
  }

  // One-time repair: wipe caches written by the old oldest-first sync so the next
  // sync of every folder reseeds NEWEST-first. Keyed in meta → runs exactly once.
  try {
    const SYNC_MODEL = '2'
    if (String(Store.getMeta('sync_model') || '') !== SYNC_MODEL) {
      Store.resetSyncCaches()
      Store.setMeta('sync_model', SYNC_MODEL)
      console.log('[EmailIpc] sync caches reset → folders will reseed newest-first')
    }
  } catch (e) { console.warn('[EmailIpc] sync-model repair failed:', e && e.message) }

  const wrap = (fn) => async (_event, args) => {
    try {
      return await fn(args)
    } catch (err) {
      return fail(err)
    }
  }

  ipcMain.handle('email:accountsList', wrap(handleAccountsList))
  ipcMain.handle('email:accountTest', wrap(handleAccountTest))
  ipcMain.handle('email:accountAdd', wrap(handleAccountAdd))
  ipcMain.handle('email:accountUpdate', wrap(handleAccountUpdate))
  ipcMain.handle('email:accountRemove', wrap(handleAccountRemove))

  ipcMain.handle('email:folders', wrap(handleFolders))
  ipcMain.handle('email:folderSync', wrap(handleFolderSync))
  ipcMain.handle('email:prefetch', wrap(handlePrefetch))
  ipcMain.handle('email:messages', wrap(handleMessages))
  ipcMain.handle('email:message', wrap(handleMessage))

  ipcMain.handle('email:markRead', wrap(handleMarkRead))
  ipcMain.handle('email:flag', wrap(handleFlag))
  ipcMain.handle('email:move', wrap(handleMove))
  ipcMain.handle('email:delete', wrap(handleDelete))
  ipcMain.handle('email:attachmentSave', wrap(handleAttachmentSave))

  ipcMain.handle('email:send', wrap(handleSend))
  ipcMain.handle('email:search', wrap(handleSearch))

  // Initial + ongoing sync so the client behaves like a proper mail app:
  //  • On launch, refill every account's standard folders (Inbox/Sent/Drafts/
  //    Spam/Trash/Archive) newest-first — detached, so the UI paints immediately.
  //  • Then poll each account's Inbox on an interval for new mail (email:new).
  const pollInboxes = () => {
    let pub = []
    try { pub = accounts.listPublicAccounts() } catch (_e) { return }
    for (const a of pub) void syncOneFolder(a.id, resolveInboxFolder(a.id))
  }
  try {
    const pub = accounts.listPublicAccounts()
    for (const a of pub) void syncStandardFolders(a.id).catch(() => {})
  } catch (_e) { /* no accounts yet — bootstrapAccount handles new adds */ }
  try { _pollTimer = setInterval(pollInboxes, POLL_MS) } catch (_e) { /* noop */ }

  // Tidy up sockets on quit so we don't leak IMAP/SMTP connections.
  try {
    app.on('before-quit', () => {
      if (_pollTimer) { try { clearInterval(_pollTimer) } catch (_e) { /* noop */ } _pollTimer = null }
      Promise.resolve(closeAllImap()).catch(() => {})
      try { smtp.closeAllTransports() } catch (_e) { /* noop */ }
    })
  } catch (_e) { /* noop */ }

  console.log('[EmailIpc] email:* IPC handlers registered')
}

export default registerEmailIpc
