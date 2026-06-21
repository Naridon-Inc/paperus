/**
 * Email subsystem — local SQLite store (better-sqlite3, synchronous API).
 *
 * Single source of truth for the on-disk mail cache. Lives at
 *   <userData>/email/mail.db   (WAL mode).
 *
 * Schema (see CLAUDE-level contract):
 *   accounts     — bring-your-own IMAP/SMTP account config (NO password; the
 *                  encrypted password lives in `meta` via accounts.js/safeStorage).
 *   folders      — per-account mailbox list + sync cursors (uidvalidity/uidnext/modseq).
 *   messages     — per-message envelope/flags (headers only; bodies are lazy).
 *   bodies       — cached rendered html/text per message (fetched on open).
 *   attachments  — per-part attachment metadata (filename/mime/size).
 *   meta         — opaque key/value (secure password blobs, schema version, …).
 *
 * Everything is keyed by (account_id, folder, uid). `uid` is the IMAP UID, which
 * is stable within a (folder, uidvalidity) generation — when UIDVALIDITY changes
 * we wipe that folder's rows and resync (handled in imap.js).
 *
 * All methods are synchronous (better-sqlite3). Prepared statements are created
 * once and reused. Nothing here throws across IPC — callers wrap in try/catch.
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const SCHEMA_VERSION = 1

class EmailStore {
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
    const dir = path.join(userData, 'email')
    fs.mkdirSync(dir, { recursive: true })
    this._dbPath = path.join(dir, 'mail.db')

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
        id          TEXT PRIMARY KEY,
        email       TEXT,
        name        TEXT,
        color       TEXT,
        provider    TEXT,
        imap_host   TEXT,
        imap_port   INTEGER,
        imap_secure INTEGER,
        smtp_host   TEXT,
        smtp_port   INTEGER,
        smtp_secure INTEGER,
        username    TEXT,
        created_at  INTEGER
      );

      CREATE TABLE IF NOT EXISTS folders (
        account_id     TEXT,
        path           TEXT,
        name           TEXT,
        special_use    TEXT,
        uid_validity   INTEGER,
        uid_next       INTEGER,
        highest_modseq TEXT,
        unseen         INTEGER,
        total          INTEGER,
        PRIMARY KEY (account_id, path)
      );

      CREATE TABLE IF NOT EXISTS messages (
        account_id      TEXT,
        folder          TEXT,
        uid             INTEGER,
        message_id      TEXT,
        in_reply_to     TEXT,
        refs            TEXT,
        from_addr       TEXT,
        from_name       TEXT,
        to_addrs        TEXT,
        cc_addrs        TEXT,
        subject         TEXT,
        date_ts         INTEGER,
        seen            INTEGER,
        flagged         INTEGER,
        has_attachments INTEGER,
        snippet         TEXT,
        PRIMARY KEY (account_id, folder, uid)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_list
        ON messages (account_id, folder, date_ts DESC);

      CREATE TABLE IF NOT EXISTS bodies (
        account_id TEXT,
        folder     TEXT,
        uid        INTEGER,
        html       TEXT,
        text       TEXT,
        PRIMARY KEY (account_id, folder, uid)
      );

      CREATE TABLE IF NOT EXISTS attachments (
        account_id TEXT,
        folder     TEXT,
        uid        INTEGER,
        part_id    TEXT,
        filename   TEXT,
        mime       TEXT,
        size       INTEGER,
        PRIMARY KEY (account_id, folder, uid, part_id)
      );

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
          (id, email, name, color, provider, imap_host, imap_port, imap_secure,
           smtp_host, smtp_port, smtp_secure, username, created_at)
        VALUES
          (@id, @email, @name, @color, @provider, @imap_host, @imap_port, @imap_secure,
           @smtp_host, @smtp_port, @smtp_secure, @username, @created_at)
        ON CONFLICT(id) DO UPDATE SET
          email       = excluded.email,
          name        = excluded.name,
          color       = excluded.color,
          provider    = excluded.provider,
          imap_host   = excluded.imap_host,
          imap_port   = excluded.imap_port,
          imap_secure = excluded.imap_secure,
          smtp_host   = excluded.smtp_host,
          smtp_port   = excluded.smtp_port,
          smtp_secure = excluded.smtp_secure,
          username    = excluded.username
      `),
      listAccounts: db.prepare('SELECT * FROM accounts ORDER BY created_at ASC'),
      getAccount: db.prepare('SELECT * FROM accounts WHERE id = ?'),
      removeAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),

      // ---- folders ----
      upsertFolder: db.prepare(`
        INSERT INTO folders
          (account_id, path, name, special_use, uid_validity, uid_next,
           highest_modseq, unseen, total)
        VALUES
          (@account_id, @path, @name, @special_use, @uid_validity, @uid_next,
           @highest_modseq, @unseen, @total)
        ON CONFLICT(account_id, path) DO UPDATE SET
          name           = excluded.name,
          special_use    = excluded.special_use,
          uid_validity   = excluded.uid_validity,
          uid_next       = excluded.uid_next,
          highest_modseq = excluded.highest_modseq,
          unseen         = excluded.unseen,
          total          = excluded.total
      `),
      listFolders: db.prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY name ASC'),
      getFolder: db.prepare('SELECT * FROM folders WHERE account_id = ? AND path = ?'),

      // ---- messages (headers) ----
      upsertMessageHeader: db.prepare(`
        INSERT INTO messages
          (account_id, folder, uid, message_id, in_reply_to, refs, from_addr,
           from_name, to_addrs, cc_addrs, subject, date_ts, seen, flagged,
           has_attachments, snippet)
        VALUES
          (@account_id, @folder, @uid, @message_id, @in_reply_to, @refs, @from_addr,
           @from_name, @to_addrs, @cc_addrs, @subject, @date_ts, @seen, @flagged,
           @has_attachments, @snippet)
        ON CONFLICT(account_id, folder, uid) DO UPDATE SET
          message_id      = excluded.message_id,
          in_reply_to     = excluded.in_reply_to,
          refs            = excluded.refs,
          from_addr       = excluded.from_addr,
          from_name       = excluded.from_name,
          to_addrs        = excluded.to_addrs,
          cc_addrs        = excluded.cc_addrs,
          subject         = excluded.subject,
          date_ts         = excluded.date_ts,
          seen            = excluded.seen,
          flagged         = excluded.flagged,
          has_attachments = excluded.has_attachments,
          snippet         = excluded.snippet
      `),
      listMessages: db.prepare(`
        SELECT * FROM messages
        WHERE account_id = @accountId AND folder = @folder
        ORDER BY date_ts DESC, uid DESC
        LIMIT @limit OFFSET @offset
      `),
      countMessages: db.prepare(
        'SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND folder = ?',
      ),
      // Newest messages whose body is NOT yet cached (no bodies row, or a row with
      // both html+text null). Drives the background body-prefetch so opening a
      // message is instant instead of a live IMAP download + parse.
      messagesNeedingBody: db.prepare(`
        SELECT m.uid AS uid FROM messages m
        LEFT JOIN bodies b
          ON b.account_id = m.account_id AND b.folder = m.folder AND b.uid = m.uid
        WHERE m.account_id = @accountId AND m.folder = @folder
          AND (b.uid IS NULL OR (b.html IS NULL AND b.text IS NULL))
        ORDER BY m.date_ts DESC, m.uid DESC
        LIMIT @limit
      `),
      countUnseen: db.prepare(
        'SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND folder = ? AND seen = 0',
      ),
      countUnseenAccount: db.prepare(
        'SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND seen = 0',
      ),
      getMessageRow: db.prepare(
        'SELECT * FROM messages WHERE account_id = ? AND folder = ? AND uid = ?',
      ),
      setFlagSeen: db.prepare(
        'UPDATE messages SET seen = ? WHERE account_id = ? AND folder = ? AND uid = ?',
      ),
      setFlagFlagged: db.prepare(
        'UPDATE messages SET flagged = ? WHERE account_id = ? AND folder = ? AND uid = ?',
      ),
      removeMessage: db.prepare(
        'DELETE FROM messages WHERE account_id = ? AND folder = ? AND uid = ?',
      ),
      searchMessages: db.prepare(`
        SELECT * FROM messages
        WHERE account_id = @accountId AND folder = @folder
          AND (subject LIKE @q OR from_addr LIKE @q OR from_name LIKE @q
               OR to_addrs LIKE @q OR snippet LIKE @q)
        ORDER BY date_ts DESC, uid DESC
        LIMIT 200
      `),
      searchMessagesAll: db.prepare(`
        SELECT * FROM messages
        WHERE account_id = @accountId
          AND (subject LIKE @q OR from_addr LIKE @q OR from_name LIKE @q
               OR to_addrs LIKE @q OR snippet LIKE @q)
        ORDER BY date_ts DESC, uid DESC
        LIMIT 200
      `),

      // ---- bulk delete (folder wipe on UIDVALIDITY change / account remove) ----
      wipeFolderMessages: db.prepare('DELETE FROM messages WHERE account_id = ? AND folder = ?'),
      wipeFolderBodies: db.prepare('DELETE FROM bodies WHERE account_id = ? AND folder = ?'),
      wipeFolderAttachments: db.prepare('DELETE FROM attachments WHERE account_id = ? AND folder = ?'),
      delAllMessages: db.prepare('DELETE FROM messages WHERE account_id = ?'),
      delAllBodies: db.prepare('DELETE FROM bodies WHERE account_id = ?'),
      delAllAttachments: db.prepare('DELETE FROM attachments WHERE account_id = ?'),
      delAllFolders: db.prepare('DELETE FROM folders WHERE account_id = ?'),
      delMetaPrefix: db.prepare('DELETE FROM meta WHERE k LIKE ?'),

      // ---- bodies ----
      getBody: db.prepare('SELECT * FROM bodies WHERE account_id = ? AND folder = ? AND uid = ?'),
      putBody: db.prepare(`
        INSERT INTO bodies (account_id, folder, uid, html, text)
        VALUES (@account_id, @folder, @uid, @html, @text)
        ON CONFLICT(account_id, folder, uid) DO UPDATE SET
          html = excluded.html,
          text = excluded.text
      `),
      removeBody: db.prepare('DELETE FROM bodies WHERE account_id = ? AND folder = ? AND uid = ?'),

      // ---- attachments ----
      putAttachmentMeta: db.prepare(`
        INSERT INTO attachments (account_id, folder, uid, part_id, filename, mime, size)
        VALUES (@account_id, @folder, @uid, @part_id, @filename, @mime, @size)
        ON CONFLICT(account_id, folder, uid, part_id) DO UPDATE SET
          filename = excluded.filename,
          mime     = excluded.mime,
          size     = excluded.size
      `),
      listAttachmentMeta: db.prepare(
        'SELECT * FROM attachments WHERE account_id = ? AND folder = ? AND uid = ? ORDER BY part_id ASC',
      ),
      getAttachmentMeta: db.prepare(
        'SELECT * FROM attachments WHERE account_id = ? AND folder = ? AND uid = ? AND part_id = ?',
      ),
      removeAttachments: db.prepare(
        'DELETE FROM attachments WHERE account_id = ? AND folder = ? AND uid = ?',
      ),

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
      email: row.email ?? null,
      name: row.name ?? null,
      color: row.color ?? null,
      provider: row.provider ?? null,
      imap_host: row.imap_host ?? null,
      imap_port: row.imap_port ?? null,
      imap_secure: row.imap_secure ? 1 : 0,
      smtp_host: row.smtp_host ?? null,
      smtp_port: row.smtp_port ?? null,
      smtp_secure: row.smtp_secure ? 1 : 0,
      username: row.username ?? null,
      created_at: row.created_at ?? Date.now(),
    })
  }

  listAccounts() {
    return this.stmts.listAccounts.all()
  }

  getAccount(id) {
    return this.stmts.getAccount.get(id)
  }

  /**
   * Remove an account and ALL of its cached data (folders, messages, bodies,
   * attachments, and any meta blobs prefixed `*_<id>`). Runs in a transaction.
   */
  removeAccount(id) {
    const tx = this.db.transaction((accountId) => {
      this.stmts.delAllAttachments.run(accountId)
      this.stmts.delAllBodies.run(accountId)
      this.stmts.delAllMessages.run(accountId)
      this.stmts.delAllFolders.run(accountId)
      this.stmts.removeAccount.run(accountId)
      // Secure password + any per-account meta: keys end with `_<id>`.
      this.stmts.delMetaPrefix.run(`%\\_${accountId}` /* note: simple suffix match below */)
    })
    // SQLite LIKE has no anchored suffix without escapes; do an explicit suffix delete.
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
  // folders
  // ----------------------------------------------------------------------------
  upsertFolder(row) {
    this.stmts.upsertFolder.run({
      account_id: row.account_id,
      path: row.path,
      name: row.name ?? row.path,
      special_use: row.special_use ?? null,
      uid_validity: row.uid_validity ?? null,
      uid_next: row.uid_next ?? null,
      highest_modseq: row.highest_modseq != null ? String(row.highest_modseq) : null,
      unseen: row.unseen ?? null,
      total: row.total ?? null,
    })
  }

  listFolders(accountId) {
    return this.stmts.listFolders.all(accountId)
  }

  getFolder(accountId, folderPath) {
    return this.stmts.getFolder.get(accountId, folderPath)
  }

  // ----------------------------------------------------------------------------
  // messages
  // ----------------------------------------------------------------------------
  upsertMessageHeader(row) {
    this.stmts.upsertMessageHeader.run({
      account_id: row.account_id,
      folder: row.folder,
      uid: row.uid,
      message_id: row.message_id ?? null,
      in_reply_to: row.in_reply_to ?? null,
      refs: row.refs ?? null,
      from_addr: row.from_addr ?? null,
      from_name: row.from_name ?? null,
      to_addrs: row.to_addrs ?? null,
      cc_addrs: row.cc_addrs ?? null,
      subject: row.subject ?? null,
      date_ts: row.date_ts ?? null,
      seen: row.seen ? 1 : 0,
      flagged: row.flagged ? 1 : 0,
      has_attachments: row.has_attachments ? 1 : 0,
      snippet: row.snippet ?? null,
    })
  }

  /** Insert many headers atomically (one transaction). */
  upsertMessageHeaders(rows) {
    const tx = this.db.transaction((list) => {
      for (const r of list) this.upsertMessageHeader(r)
    })
    tx(rows)
  }

  listMessages({ accountId, folder, offset = 0, limit = 50 }) {
    const lim = Math.max(1, Math.min(500, Number(limit) || 50))
    const off = Math.max(0, Number(offset) || 0)
    return this.stmts.listMessages.all({ accountId, folder, limit: lim, offset: off })
  }

  /** UIDs (newest-first) of messages in this folder with no cached body yet. */
  listMessagesNeedingBody({ accountId, folder, limit = 20 }) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 20))
    return this.stmts.messagesNeedingBody.all({ accountId, folder, limit: lim }).map((r) => r.uid)
  }

  countMessages(accountId, folder) {
    const r = this.stmts.countMessages.get(accountId, folder)
    return r ? r.n : 0
  }

  countUnseen(accountId, folder) {
    const r = this.stmts.countUnseen.get(accountId, folder)
    return r ? r.n : 0
  }

  countUnseenAccount(accountId) {
    const r = this.stmts.countUnseenAccount.get(accountId)
    return r ? r.n : 0
  }

  // ── Sync-model repair (one-time migrations keyed in the meta table) ──────────
  getMeta(k) {
    try { const r = this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null } catch (_e) { return null }
  }

  setMeta(k, v) {
    try { this.db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(k, String(v)) } catch (_e) { /* noop */ }
  }

  /**
   * Drop every cached message/body/attachment and null all folder UID cursors so
   * the next sync of each folder reseeds NEWEST-first. Used once to repair caches
   * written by the old oldest-first sync bug. Server mail is untouched.
   */
  resetSyncCaches() {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages').run()
      this.db.prepare('DELETE FROM bodies').run()
      this.db.prepare('DELETE FROM attachments').run()
      this.db.prepare('UPDATE folders SET uid_next = NULL').run()
    })
    try { tx() } catch (_e) { /* best-effort */ }
  }

  /**
   * Unified inbox across accounts: messages from a set of (accountId, folder)
   * inbox pairs, newest-first. `inboxes` = [{ accountId, folder }]. Built as an OR
   * of (account_id=? AND folder=?) groups so the (account_id, folder, date_ts)
   * index still drives each arm; SQLite merges + sorts the union. SQL text is
   * stable per inbox-count, so better-sqlite3's statement cache reuses it.
   */
  listMessagesUnified({ inboxes, offset = 0, limit = 50 }) {
    if (!Array.isArray(inboxes) || !inboxes.length) return []
    const lim = Math.max(1, Math.min(500, Number(limit) || 50))
    const off = Math.max(0, Number(offset) || 0)
    const where = inboxes.map(() => '(account_id = ? AND folder = ?)').join(' OR ')
    const params = []
    for (const ib of inboxes) params.push(ib.accountId, ib.folder)
    const sql = `SELECT * FROM messages WHERE ${where} ORDER BY date_ts DESC, uid DESC LIMIT ? OFFSET ?`
    return this.db.prepare(sql).all(...params, lim, off)
  }

  countMessagesUnified(inboxes) {
    if (!Array.isArray(inboxes) || !inboxes.length) return 0
    const where = inboxes.map(() => '(account_id = ? AND folder = ?)').join(' OR ')
    const params = []
    for (const ib of inboxes) params.push(ib.accountId, ib.folder)
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`).get(...params)
    return r ? r.n : 0
  }

  getMessageRow(accountId, folder, uid) {
    return this.stmts.getMessageRow.get(accountId, folder, uid)
  }

  /** field: 'seen' | 'flagged'. value: boolean. */
  setFlag(accountId, folder, uid, field, value) {
    const v = value ? 1 : 0
    if (field === 'seen') this.stmts.setFlagSeen.run(v, accountId, folder, uid)
    else if (field === 'flagged') this.stmts.setFlagFlagged.run(v, accountId, folder, uid)
  }

  /** Remove a single message and its dependent body/attachment rows. */
  removeMessage(accountId, folder, uid) {
    const tx = this.db.transaction(() => {
      this.stmts.removeMessage.run(accountId, folder, uid)
      this.stmts.removeBody.run(accountId, folder, uid)
      this.stmts.removeAttachments.run(accountId, folder, uid)
    })
    tx()
  }

  /** Wipe an entire folder's cached rows (used on UIDVALIDITY change). */
  wipeFolder(accountId, folder) {
    const tx = this.db.transaction(() => {
      this.stmts.wipeFolderMessages.run(accountId, folder)
      this.stmts.wipeFolderBodies.run(accountId, folder)
      this.stmts.wipeFolderAttachments.run(accountId, folder)
    })
    tx()
  }

  searchMessages(accountId, query, folder) {
    const q = `%${String(query || '').replace(/[%_]/g, (m) => `\\${m}`)}%`
    if (folder) return this.stmts.searchMessages.all({ accountId, folder, q })
    return this.stmts.searchMessagesAll.all({ accountId, q })
  }

  // ----------------------------------------------------------------------------
  // bodies
  // ----------------------------------------------------------------------------
  getBody(accountId, folder, uid) {
    return this.stmts.getBody.get(accountId, folder, uid)
  }

  putBody({ accountId, folder, uid, html, text }) {
    this.stmts.putBody.run({
      account_id: accountId,
      folder,
      uid,
      html: html ?? null,
      text: text ?? null,
    })
  }

  // ----------------------------------------------------------------------------
  // attachments
  // ----------------------------------------------------------------------------
  putAttachmentMeta({ accountId, folder, uid, partId, filename, mime, size }) {
    this.stmts.putAttachmentMeta.run({
      account_id: accountId,
      folder,
      uid,
      part_id: String(partId),
      filename: filename ?? null,
      mime: mime ?? null,
      size: size ?? null,
    })
  }

  putAttachmentMetas(accountId, folder, uid, list) {
    const tx = this.db.transaction((items) => {
      for (const a of items) {
        this.putAttachmentMeta({
          accountId,
          folder,
          uid,
          partId: a.partId,
          filename: a.filename,
          mime: a.mime,
          size: a.size,
        })
      }
    })
    tx(list || [])
  }

  listAttachmentMeta(accountId, folder, uid) {
    return this.stmts.listAttachmentMeta.all(accountId, folder, uid)
  }

  getAttachmentMeta(accountId, folder, uid, partId) {
    return this.stmts.getAttachmentMeta.get(accountId, folder, uid, String(partId))
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
export const Store = new EmailStore()
export default Store
