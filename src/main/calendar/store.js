/**
 * Calendar subsystem — local SQLite store (better-sqlite3, synchronous API).
 *
 * Single source of truth for the on-disk CalDAV cache. Lives at
 *   <userData>/calendar/cal.db   (WAL mode).
 *
 * Schema:
 *   accounts   — bring-your-own CalDAV account config (NO password; the encrypted
 *                password lives in `meta` via accounts.js/safeStorage).
 *   calendars  — per-account calendar collections + sync cursors (ctag/sync_token)
 *                and a per-calendar `visible` toggle.
 *   events     — per-event base row (the un-expanded VEVENT) keyed by
 *                (calendar_id, uid). `raw_ics` keeps the full source so we can
 *                re-expand recurrences and round-trip edits; `rrule` is cached for
 *                quick "does this recur?" checks.
 *   meta       — opaque key/value (secure password blobs, schema version, …).
 *
 * Mirrors src/main/email/store.js exactly: a singleton DB handle, prepared
 * statements created once, all methods synchronous, nothing throws across IPC
 * (callers wrap in try/catch).
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const SCHEMA_VERSION = 1

class CalendarStore {
  constructor() {
    this.db = null
    this.stmts = null
    this._dbPath = null
  }

  /**
   * Open (or create) the database. Idempotent: a second call returns the same
   * handle. `app` is the Electron app (used only for userData path resolution).
   */
  init(app) {
    if (this.db) return this.db

    const userData = app.getPath('userData')
    const dir = path.join(userData, 'calendar')
    fs.mkdirSync(dir, { recursive: true })
    this._dbPath = path.join(dir, 'cal.db')

    const db = new Database(this._dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = OFF')

    this.db = db
    this._migrate()
    this._prepare()
    return db
  }

  _migrate() {
    const db = this.db
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id         TEXT PRIMARY KEY,
        name       TEXT,
        email      TEXT,
        provider   TEXT,
        server     TEXT,
        color      TEXT,
        created_ts INTEGER
      );

      CREATE TABLE IF NOT EXISTS calendars (
        id         TEXT PRIMARY KEY,
        account_id TEXT,
        url        TEXT,
        name       TEXT,
        color      TEXT,
        ctag       TEXT,
        sync_token TEXT,
        visible    INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_calendars_account
        ON calendars (account_id);

      CREATE TABLE IF NOT EXISTS events (
        account_id  TEXT,
        calendar_id TEXT,
        uid         TEXT,
        start_ts    INTEGER,
        end_ts      INTEGER,
        all_day     INTEGER,
        summary     TEXT,
        location    TEXT,
        rrule       TEXT,
        raw_ics     TEXT,
        url         TEXT,
        etag        TEXT,
        PRIMARY KEY (calendar_id, uid)
      );

      CREATE INDEX IF NOT EXISTS idx_events_range
        ON events (calendar_id, start_ts);

      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT
      );
    `)

    // Record schema version (best-effort).
    const cur = db.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version')
    if (!cur) {
      db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(
        'schema_version',
        String(SCHEMA_VERSION),
      )
    }
  }

  _prepare() {
    const db = this.db
    this.stmts = {
      // ---- accounts ----
      upsertAccount: db.prepare(`
        INSERT INTO accounts
          (id, name, email, provider, server, color, created_ts)
        VALUES
          (@id, @name, @email, @provider, @server, @color, @created_ts)
        ON CONFLICT(id) DO UPDATE SET
          name     = excluded.name,
          email    = excluded.email,
          provider = excluded.provider,
          server   = excluded.server,
          color    = excluded.color
      `),
      listAccounts: db.prepare('SELECT * FROM accounts ORDER BY created_ts ASC'),
      getAccount: db.prepare('SELECT * FROM accounts WHERE id = ?'),
      removeAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),

      // ---- calendars ----
      upsertCalendar: db.prepare(`
        INSERT INTO calendars
          (id, account_id, url, name, color, ctag, sync_token, visible)
        VALUES
          (@id, @account_id, @url, @name, @color, @ctag, @sync_token, @visible)
        ON CONFLICT(id) DO UPDATE SET
          account_id = excluded.account_id,
          url        = excluded.url,
          name       = excluded.name,
          color      = excluded.color,
          ctag       = excluded.ctag,
          sync_token = excluded.sync_token
      `),
      listCalendars: db.prepare('SELECT * FROM calendars ORDER BY name ASC'),
      listCalendarsForAccount: db.prepare(
        'SELECT * FROM calendars WHERE account_id = ? ORDER BY name ASC',
      ),
      getCalendar: db.prepare('SELECT * FROM calendars WHERE id = ?'),
      setCalendarVisible: db.prepare('UPDATE calendars SET visible = ? WHERE id = ?'),
      setCalendarSync: db.prepare(
        'UPDATE calendars SET ctag = ?, sync_token = ? WHERE id = ?',
      ),
      delCalendarsForAccount: db.prepare('DELETE FROM calendars WHERE account_id = ?'),

      // ---- events ----
      upsertEvent: db.prepare(`
        INSERT INTO events
          (account_id, calendar_id, uid, start_ts, end_ts, all_day, summary,
           location, rrule, raw_ics, url, etag)
        VALUES
          (@account_id, @calendar_id, @uid, @start_ts, @end_ts, @all_day, @summary,
           @location, @rrule, @raw_ics, @url, @etag)
        ON CONFLICT(calendar_id, uid) DO UPDATE SET
          account_id = excluded.account_id,
          start_ts   = excluded.start_ts,
          end_ts     = excluded.end_ts,
          all_day    = excluded.all_day,
          summary    = excluded.summary,
          location   = excluded.location,
          rrule      = excluded.rrule,
          raw_ics    = excluded.raw_ics,
          url        = excluded.url,
          etag       = excluded.etag
      `),
      getEvent: db.prepare('SELECT * FROM events WHERE calendar_id = ? AND uid = ?'),
      removeEvent: db.prepare('DELETE FROM events WHERE calendar_id = ? AND uid = ?'),
      delEventsForCalendar: db.prepare('DELETE FROM events WHERE calendar_id = ?'),
      delEventsForAccount: db.prepare('DELETE FROM events WHERE account_id = ?'),

      // Range query: events whose [start_ts,end_ts] overlaps [@startTs,@endTs],
      // restricted to VISIBLE calendars (visible = 1). Recurring events have a
      // non-null rrule and may produce instances outside their base row's
      // window, so they are ALWAYS included (the caller expands + filters).
      listEventsVisible: db.prepare(`
        SELECT e.*, c.color AS cal_color, c.visible AS cal_visible
        FROM events e
        JOIN calendars c ON c.id = e.calendar_id
        WHERE c.visible = 1
          AND (
            e.rrule IS NOT NULL
            OR (e.start_ts <= @endTs AND e.end_ts >= @startTs)
          )
        ORDER BY e.start_ts ASC
      `),
      listEventsAll: db.prepare(`
        SELECT e.*, c.color AS cal_color, c.visible AS cal_visible
        FROM events e
        JOIN calendars c ON c.id = e.calendar_id
        WHERE (
            e.rrule IS NOT NULL
            OR (e.start_ts <= @endTs AND e.end_ts >= @startTs)
          )
        ORDER BY e.start_ts ASC
      `),
      listEventsVisibleAccount: db.prepare(`
        SELECT e.*, c.color AS cal_color, c.visible AS cal_visible
        FROM events e
        JOIN calendars c ON c.id = e.calendar_id
        WHERE c.visible = 1 AND e.account_id = @accountId
          AND (
            e.rrule IS NOT NULL
            OR (e.start_ts <= @endTs AND e.end_ts >= @startTs)
          )
        ORDER BY e.start_ts ASC
      `),
      listEventsAllAccount: db.prepare(`
        SELECT e.*, c.color AS cal_color, c.visible AS cal_visible
        FROM events e
        JOIN calendars c ON c.id = e.calendar_id
        WHERE e.account_id = @accountId
          AND (
            e.rrule IS NOT NULL
            OR (e.start_ts <= @endTs AND e.end_ts >= @startTs)
          )
        ORDER BY e.start_ts ASC
      `),

      // ---- bulk delete (account remove) ----
      delMetaPrefix: db.prepare('DELETE FROM meta WHERE k LIKE ?'),

      // ---- meta ----
      getMeta: db.prepare('SELECT v FROM meta WHERE k = ?'),
      setMeta: db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)'),
      delMeta: db.prepare('DELETE FROM meta WHERE k = ?'),
    }
  }

  // ----------------------------------------------------------------------------
  // accounts
  // ----------------------------------------------------------------------------
  upsertAccount(row) {
    this.stmts.upsertAccount.run({
      id: row.id,
      name: row.name ?? null,
      email: row.email ?? null,
      provider: row.provider ?? null,
      server: row.server ?? null,
      color: row.color ?? null,
      created_ts: row.created_ts ?? Date.now(),
    })
  }

  listAccounts() {
    return this.stmts.listAccounts.all()
  }

  getAccount(id) {
    return this.stmts.getAccount.get(id)
  }

  /**
   * Remove an account and ALL of its cached data (calendars, events, and any
   * meta blobs whose key ends with `_<id>`, i.e. the secure password). Runs in a
   * transaction. Mirrors EmailStore.removeAccount.
   */
  removeAccount(id) {
    const tx = this.db.transaction((accountId) => {
      this.stmts.delEventsForAccount.run(accountId)
      this.stmts.delCalendarsForAccount.run(accountId)
      this.stmts.removeAccount.run(accountId)
    })
    // SQLite LIKE has no anchored suffix without escapes; do an explicit suffix
    // delete of per-account meta keys (`*_<id>`).
    const tx2 = this.db.transaction((accountId) => {
      const rows = this.db.prepare('SELECT k FROM meta').all()
      const del = this.stmts.delMeta
      for (const r of rows) {
        if (typeof r.k === 'string' && r.k.endsWith(`_${accountId}`)) del.run(r.k)
      }
    })
    tx(id)
    tx2(id)
  }

  // ----------------------------------------------------------------------------
  // calendars
  // ----------------------------------------------------------------------------
  upsertCalendar(row) {
    this.stmts.upsertCalendar.run({
      id: row.id,
      account_id: row.account_id ?? null,
      url: row.url ?? null,
      name: row.name ?? null,
      color: row.color ?? null,
      ctag: row.ctag ?? null,
      sync_token: row.sync_token ?? null,
      visible: row.visible == null ? 1 : (row.visible ? 1 : 0),
    })
  }

  listCalendars(accountId) {
    if (accountId) return this.stmts.listCalendarsForAccount.all(accountId)
    return this.stmts.listCalendars.all()
  }

  getCalendar(id) {
    return this.stmts.getCalendar.get(id)
  }

  setCalendarVisible(id, visible) {
    this.stmts.setCalendarVisible.run(visible ? 1 : 0, id)
  }

  setCalendarSync(id, ctag, syncToken) {
    this.stmts.setCalendarSync.run(ctag ?? null, syncToken ?? null, id)
  }

  // ----------------------------------------------------------------------------
  // events
  // ----------------------------------------------------------------------------
  upsertEvent(row) {
    this.stmts.upsertEvent.run({
      account_id: row.account_id ?? null,
      calendar_id: row.calendar_id,
      uid: String(row.uid),
      start_ts: row.start_ts ?? null,
      end_ts: row.end_ts ?? null,
      all_day: row.all_day ? 1 : 0,
      summary: row.summary ?? null,
      location: row.location ?? null,
      rrule: row.rrule ?? null,
      raw_ics: row.raw_ics ?? null,
      url: row.url ?? null,
      etag: row.etag ?? null,
    })
  }

  /** Insert many events atomically (one transaction). */
  upsertEvents(rows) {
    const tx = this.db.transaction((list) => {
      for (const r of list) this.upsertEvent(r)
    })
    tx(rows || [])
  }

  getEvent(calendarId, uid) {
    return this.stmts.getEvent.get(calendarId, String(uid))
  }

  removeEvent(calendarId, uid) {
    this.stmts.removeEvent.run(calendarId, String(uid))
  }

  /** Replace a calendar's entire event set (used on a full resync). */
  replaceCalendarEvents(calendarId, rows) {
    const tx = this.db.transaction((cid, list) => {
      this.stmts.delEventsForCalendar.run(cid)
      for (const r of list) this.upsertEvent(r)
    })
    tx(calendarId, rows || [])
  }

  delEventsForCalendar(calendarId) {
    this.stmts.delEventsForCalendar.run(calendarId)
  }

  /**
   * Range query for base event rows whose window overlaps [startTs,endTs], or
   * which recur (rrule present). `visibleOnly` (default true) restricts to
   * calendars with visible = 1. Optional `accountId` scopes to one account.
   * Returns rows augmented with `cal_color` (the calendar's color).
   */
  listEvents({ startTs, endTs, visibleOnly = true, accountId = null }) {
    const params = { startTs: Number(startTs), endTs: Number(endTs), accountId }
    if (accountId) {
      return visibleOnly
        ? this.stmts.listEventsVisibleAccount.all(params)
        : this.stmts.listEventsAllAccount.all(params)
    }
    return visibleOnly
      ? this.stmts.listEventsVisible.all(params)
      : this.stmts.listEventsAll.all(params)
  }

  // ----------------------------------------------------------------------------
  // meta (used by accounts.js for safeStorage password blobs)
  // ----------------------------------------------------------------------------
  getMeta(k) {
    const r = this.stmts.getMeta.get(k)
    return r ? r.v : null
  }

  setMeta(k, v) {
    this.stmts.setMeta.run(k, v == null ? null : String(v))
  }

  delMeta(k) {
    this.stmts.delMeta.run(k)
  }

  close() {
    if (this.db) {
      try { this.db.close() } catch (_e) { /* noop */ }
      this.db = null
      this.stmts = null
    }
  }
}

// Singleton — one DB handle for the whole main process.
export const Store = new CalendarStore()
export default Store
