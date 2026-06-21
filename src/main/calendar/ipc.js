/**
 * Calendar subsystem — IPC surface. `registerCalendarIpc(app, { getMainWindow })`.
 *
 * Registers every `calendar:*` channel from the renderer contract. Conventions
 * mirror src/main/email/ipc.js exactly:
 *  - Idempotent (`_registered` guard); never throws at import or registration.
 *  - EVERY handler is wrapped try/catch and returns a JSON-serializable
 *    `{ ok:true, ... }` / `{ ok:false, error:string }` — never throws across IPC.
 *  - Push events ride the existing `message` channel:
 *      webContents.send('message', 'calendar:changed', { accountId })
 *
 * SECURITY:
 *  - The decrypted account password never crosses IPC and is never logged.
 *  - Adding/testing an account is refused if OS secure storage is unavailable.
 */

import { ipcMain } from 'electron'

import { Store } from './store.js'
import * as accounts from './accounts.js'
import * as caldav from './caldav.js'

let _registered = false
let _getMainWindow = () => null

function ok(extra = {}) {
  return { ok: true, ...extra }
}

function fail(err) {
  const msg = err && err.message
    ? err.message
    : (typeof err === 'string' ? err : 'calendar error')
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

function requireAccount(accountId) {
  if (!accountId || !accounts.accountExists(accountId)) {
    throw new Error('unknown account')
  }
}

// ---- shape helpers (Store row -> renderer descriptor) -----------------------

function calendarToPublic(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    url: row.url,
    name: row.name,
    color: row.color,
    visible: row.visible !== 0,
  }
}

function instanceToPublic(inst) {
  return {
    id: `${inst.calendar_id}:${inst.uid}:${inst.start_ts}`,
    calendarId: inst.calendar_id,
    accountId: inst.account_id,
    uid: inst.uid,
    title: inst.summary || '',
    startISO: inst.start_ts != null ? new Date(inst.start_ts).toISOString() : null,
    endISO: inst.end_ts != null ? new Date(inst.end_ts).toISOString() : null,
    allDay: !!inst.all_day,
    location: inst.location || '',
    color: inst.cal_color || null,
  }
}

function toMs(iso, fallback) {
  if (iso == null) return fallback
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : fallback
}

// ---- handlers ---------------------------------------------------------------

async function handleAccountsList() {
  return ok({ accounts: accounts.listPublicAccounts() })
}

async function handleAccountTest(args) {
  const { provider, server, username, password } = args || {}
  if (!accounts.secureStorageAvailable()) return fail('OS secure storage unavailable')
  if (!server) return fail('CalDAV server URL required')
  if (!username || !password) return fail('username and password required')

  const calendars = await caldav.testConnection({ provider, server, username, password })
  return ok({ calendars })
}

async function handleAccountAdd(args) {
  const {
    provider, server, username, password, name, color,
  } = args || {}
  if (!accounts.secureStorageAvailable()) return fail('OS secure storage unavailable')
  if (!server) return fail('CalDAV server URL required')
  if (!username || !password) return fail('username and password required')

  const accountId = accounts.newAccountId()

  // Persist the secure password FIRST; if that fails (storage unavailable mid-
  // flight) we never write a usable account.
  const savedPw = accounts.saveSecurePassword(accountId, password)
  if (!savedPw) return fail('OS secure storage unavailable')

  try {
    accounts.persistAccountConfig(accountId, {
      name: name || username,
      email: username,
      provider: provider || 'generic',
      server,
      color: color || null,
    })
  } catch (e) {
    accounts.clearSecurePassword(accountId)
    return fail(e && e.message ? e.message : 'failed to persist account')
  }

  // Discover calendars + run an initial sync of each. If discovery/sync fails
  // (bad credentials, offline), roll the account back so we never leave a broken
  // account behind — the renderer should have validated via accountTest first.
  const accountRow = Store.getAccount(accountId)
  try {
    const cals = await caldav.discoverCalendars(accountRow)
    for (const cal of cals) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await caldav.syncCalendar(accountRow, cal)
      } catch (_e) { /* a single calendar failing shouldn't abort the add */ }
    }
  } catch (e) {
    accounts.clearSecurePassword(accountId)
    Store.removeAccount(accountId)
    return fail(e && e.message ? e.message : 'failed to discover calendars')
  }

  send('calendar:changed', { accountId })
  return ok({ account: accounts.publicAccount(Store.getAccount(accountId)) })
}

async function handleAccountRemove(args) {
  const id = args && args.id
  requireAccount(id)
  accounts.clearSecurePassword(id)
  Store.removeAccount(id) // wipes calendars + events + per-account meta
  send('calendar:changed', { accountId: id })
  return ok()
}

async function handleCalendars(args) {
  const accountId = args && args.accountId
  if (accountId) requireAccount(accountId)
  const rows = Store.listCalendars(accountId || null)
  return ok({ calendars: rows.map(calendarToPublic) })
}

async function handleCalendarSetVisible(args) {
  const { calendarId, visible } = args || {}
  if (!calendarId) return fail('calendarId required')
  const cal = Store.getCalendar(calendarId)
  if (!cal) return fail('unknown calendar')
  Store.setCalendarVisible(calendarId, !!visible)
  send('calendar:changed', { accountId: cal.account_id })
  return ok()
}

async function handleEvents(args) {
  const { startISO, endISO, accountId } = args || {}
  if (accountId) requireAccount(accountId)
  const startTs = toMs(startISO, null)
  const endTs = toMs(endISO, null)
  if (startTs == null || endTs == null) return fail('startISO and endISO required')

  // Pull base rows from VISIBLE calendars that overlap (or recur into) the
  // window, then expand recurrences strictly within [startTs,endTs].
  const rows = Store.listEvents({
    startTs, endTs, visibleOnly: true, accountId: accountId || null,
  })
  const instances = caldav.expandEvents(rows, startTs, endTs)
  return ok({ events: instances.map(instanceToPublic) })
}

async function handleEventCreate(args) {
  const {
    calendarId, title, startISO, endISO, allDay, location, description,
  } = args || {}
  if (!calendarId) return fail('calendarId required')
  const cal = Store.getCalendar(calendarId)
  if (!cal) return fail('unknown calendar')
  requireAccount(cal.account_id)
  const startMs = toMs(startISO, null)
  if (startMs == null) return fail('startISO required')

  const account = Store.getAccount(cal.account_id)
  const created = await caldav.createEvent(account, cal, {
    title: title || '',
    startMs,
    endMs: toMs(endISO, null),
    allDay: !!allDay,
    location,
    description,
  })

  send('calendar:changed', { accountId: cal.account_id })

  // Return the created event in the same shape `calendar:events` emits.
  const row = Store.getEvent(created.calendarId, created.uid)
  let event = null
  if (row) {
    const [inst] = caldav.expandEvents(
      [{ ...row, cal_color: cal.color }],
      row.start_ts != null ? row.start_ts : 0,
      row.end_ts != null ? row.end_ts : Number.MAX_SAFE_INTEGER,
    )
    event = inst ? instanceToPublic(inst) : null
  }
  return ok({ event })
}

async function handleEventUpdate(args) {
  const {
    calendarId, uid, title, startISO, endISO, allDay, location, description,
  } = args || {}
  if (!calendarId || uid == null) return fail('calendarId and uid required')
  const cal = Store.getCalendar(calendarId)
  if (!cal) return fail('unknown calendar')
  requireAccount(cal.account_id)

  const account = Store.getAccount(cal.account_id)
  const patch = {}
  if (title != null) patch.title = title
  if (startISO != null) patch.startMs = toMs(startISO, undefined)
  if (endISO != null) patch.endMs = toMs(endISO, undefined)
  if (allDay != null) patch.allDay = !!allDay
  if (location != null) patch.location = location
  if (description != null) patch.description = description

  await caldav.updateEvent(account, cal, String(uid), patch)
  send('calendar:changed', { accountId: cal.account_id })
  return ok()
}

async function handleEventDelete(args) {
  const { calendarId, uid } = args || {}
  if (!calendarId || uid == null) return fail('calendarId and uid required')
  const cal = Store.getCalendar(calendarId)
  if (!cal) return fail('unknown calendar')
  requireAccount(cal.account_id)

  const account = Store.getAccount(cal.account_id)
  await caldav.deleteEvent(account, cal, String(uid))
  send('calendar:changed', { accountId: cal.account_id })
  return ok()
}

async function handleSync(args) {
  const accountId = args && args.accountId
  if (accountId) requireAccount(accountId)

  const accountIds = accountId
    ? [accountId]
    : Store.listAccounts().map((a) => a.id)

  for (const id of accountIds) {
    const account = Store.getAccount(id)
    if (!account) continue
    let cals
    try {
      // eslint-disable-next-line no-await-in-loop
      cals = await caldav.discoverCalendars(account)
    } catch (_e) {
      // Offline / auth failure for this account: skip, sync what we can.
      continue
    }
    for (const cal of cals) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await caldav.syncCalendar(account, cal)
      } catch (_e) { /* per-calendar failures are non-fatal */ }
    }
    send('calendar:changed', { accountId: id })
  }

  return ok()
}

// ---- registration -----------------------------------------------------------

/**
 * Register all calendar:* IPC handlers. Idempotent and import-safe.
 *
 * @param {import('electron').App} app
 * @param {{ getMainWindow?: () => import('electron').BrowserWindow|null }} opts
 */
export function registerCalendarIpc(app, opts = {}) {
  if (_registered) return
  _registered = true
  _getMainWindow = (opts && typeof opts.getMainWindow === 'function')
    ? opts.getMainWindow
    : () => null

  // Open the DB up front so the first IPC call is fast. Defensive: never throw.
  try {
    Store.init(app)
  } catch (e) {
    console.warn('[CalendarIpc] Store init failed; calendar disabled:', e && e.message)
    return
  }

  const wrap = (fn) => async (_event, args) => {
    try {
      return await fn(args)
    } catch (err) {
      return fail(err)
    }
  }

  ipcMain.handle('calendar:accountsList', wrap(handleAccountsList))
  ipcMain.handle('calendar:accountTest', wrap(handleAccountTest))
  ipcMain.handle('calendar:accountAdd', wrap(handleAccountAdd))
  ipcMain.handle('calendar:accountRemove', wrap(handleAccountRemove))

  ipcMain.handle('calendar:calendars', wrap(handleCalendars))
  ipcMain.handle('calendar:calendarSetVisible', wrap(handleCalendarSetVisible))

  ipcMain.handle('calendar:events', wrap(handleEvents))
  ipcMain.handle('calendar:eventCreate', wrap(handleEventCreate))
  ipcMain.handle('calendar:eventUpdate', wrap(handleEventUpdate))
  ipcMain.handle('calendar:eventDelete', wrap(handleEventDelete))

  ipcMain.handle('calendar:sync', wrap(handleSync))

  console.log('[CalendarIpc] calendar:* IPC handlers registered')
}

export default registerCalendarIpc
