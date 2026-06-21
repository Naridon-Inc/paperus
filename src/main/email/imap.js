/**
 * Email subsystem — IMAP operations layer (on top of pool.js + Store).
 *
 * Responsibilities:
 *  - listFolders(accountId): enumerate mailboxes, normalize special-use, persist.
 *  - syncFolder(accountId, folder, {onProgress}): headers-first INCREMENTAL sync.
 *      Honors UIDVALIDITY (wipe+resync on change) and only fetches UIDs at/above
 *      the stored `uid_next` cursor. Upserts envelope/flags/snippet headers.
 *  - getMessage(accountId, folder, uid): return cached body if present, else
 *      fetch source, parse with mailparser, cache html/text + attachment meta.
 *      No sanitization here — the renderer sanitizes HTML before display.
 *  - setSeen / setFlagged / move / deleteMessage / saveAttachment.
 *
 * Polling-based (no IDLE in v1). All functions assume a usable connection from
 * pool.js and let errors propagate to the IPC layer for `{ok:false}` mapping.
 */

import path from 'path'
import fs from 'fs'
// mailparser is CommonJS — default-import then destructure (a named ESM import of
// `simpleParser` is unresolvable once the dep is externalized in the main build).
import mailparser from 'mailparser'

const { simpleParser } = mailparser
import { withLock, getClient } from './pool.js'
import { Store } from './store.js'
import { planFolderFetch, nextSyncCursor } from './sync-plan.js'

const SNIPPET_LEN = 200
// Cap per-sync header fetches so a brand-new huge mailbox doesn't block forever;
// repeated syncs walk backward via the uid_next cursor on subsequent calls.
const MAX_FETCH_PER_SYNC = 500

// How many of the newest un-cached bodies to warm in the background per prefetch
// pass, and the pause between each so a user-initiated open can grab the folder
// lock ahead of the queue. Keeps "open a message" instant without hammering IMAP.
const PREFETCH_BODIES = 20
const PREFETCH_GAP_MS = 40
// Folders with a prefetch loop already running, so concurrent triggers (a sync
// finishing while the user views the same folder) don't stack duplicate work.
const _prefetching = new Set()
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SPECIAL_USE_MAP = {
  '\\Inbox': 'Inbox',
  '\\Sent': 'Sent',
  '\\Drafts': 'Drafts',
  '\\Trash': 'Trash',
  '\\Junk': 'Junk',
  '\\Archive': 'Archive',
  '\\All': 'All',
  '\\Flagged': 'Flagged',
  '\\Important': 'Important',
}

const NAME_HINTS = [
  [/^inbox$/i, 'Inbox'],
  [/sent/i, 'Sent'],
  [/draft/i, 'Drafts'],
  [/trash|deleted/i, 'Trash'],
  [/junk|spam/i, 'Junk'],
  [/archive/i, 'Archive'],
]

function normalizeSpecialUse(mailbox) {
  // imapflow exposes `specialUse` like '\\Sent' and `flags` Set for some servers.
  if (mailbox.specialUse && SPECIAL_USE_MAP[mailbox.specialUse]) {
    return SPECIAL_USE_MAP[mailbox.specialUse]
  }
  const flags = mailbox.flags
  if (flags) {
    for (const f of flags) {
      if (SPECIAL_USE_MAP[f]) return SPECIAL_USE_MAP[f]
    }
  }
  const name = mailbox.path || mailbox.name || ''
  if (/^inbox$/i.test(name)) return 'Inbox'
  for (const [re, label] of NAME_HINTS) {
    if (re.test(name)) return label
  }
  return null
}

/**
 * Enumerate mailboxes and persist them. Returns an array of
 * { path, name, specialUse, unread, total }. Uses STATUS for counts.
 */
export async function listFolders(accountId) {
  const client = await getClient(accountId)
  const boxes = await client.list()
  const out = []

  for (const mb of boxes) {
    // Skip non-selectable containers (e.g. \Noselect parents).
    const selectable = !(mb.flags && (mb.flags.has?.('\\Noselect') || mb.flags.has?.('\\NonExistent')))
    const specialUse = normalizeSpecialUse(mb)
    const folderPath = mb.path
    const name = mb.name || folderPath

    let unseen = null
    let total = null
    let uidNext = null
    let uidValidity = null

    if (selectable) {
      try {
        const st = await client.status(folderPath, {
          messages: true,
          unseen: true,
          uidNext: true,
          uidValidity: true,
          highestModseq: true,
        })
        total = st.messages ?? null
        unseen = st.unseen ?? null
        uidNext = st.uidNext ?? null
        uidValidity = st.uidValidity != null ? Number(st.uidValidity) : null
      } catch (_e) {
        // Some folders reject STATUS; leave counts null.
      }
    }

    // Preserve the existing uid cursor if STATUS didn't move it backward.
    const prev = Store.getFolder(accountId, folderPath)
    const row = {
      account_id: accountId,
      path: folderPath,
      name,
      special_use: specialUse,
      uid_validity: uidValidity ?? prev?.uid_validity ?? null,
      // Keep our sync cursor (prev.uid_next) — do NOT overwrite with the
      // server's current uidNext here, or syncFolder would skip new mail.
      uid_next: prev?.uid_next ?? null,
      highest_modseq: prev?.highest_modseq ?? null,
      unseen,
      total,
    }
    Store.upsertFolder(row)

    if (selectable) {
      out.push({
        path: folderPath,
        name,
        specialUse,
        unread: unseen ?? Store.countUnseen(accountId, folderPath),
        total: total ?? Store.countMessages(accountId, folderPath),
      })
    }
  }

  return out
}

function firstAddr(addressObj) {
  // mailparser/imapflow envelope address shape: { name, address } or list.
  if (!addressObj) return { name: '', address: '' }
  const list = Array.isArray(addressObj) ? addressObj : (addressObj.value || [addressObj])
  const a = list[0] || {}
  return { name: a.name || '', address: a.address || '' }
}

function joinAddrs(addressObj) {
  if (!addressObj) return ''
  const list = Array.isArray(addressObj) ? addressObj : (addressObj.value || [addressObj])
  return list
    .map((a) => (a.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : ''))
    .filter(Boolean)
    .join(', ')
}

function envelopeAddrName(envAddrList) {
  const a = (envAddrList && envAddrList[0]) || {}
  return { name: a.name || '', address: a.address || '' }
}

function envelopeAddrJoin(envAddrList) {
  if (!envAddrList || !envAddrList.length) return ''
  return envAddrList
    .map((a) => (a.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : ''))
    .filter(Boolean)
    .join(', ')
}

function buildSnippet(text) {
  if (!text) return ''
  return String(text).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN)
}

/**
 * Headers-first incremental sync of one folder. Returns { newCount }.
 *
 * Strategy:
 *  1. Open the mailbox (read-only) under a lock; read live UIDVALIDITY/uidNext.
 *  2. If stored UIDVALIDITY differs → wipe the folder's cached rows and reset
 *     the cursor (full resync from uid 1).
 *  3. Fetch envelope/flags/internalDate/size for every UID >= storedCursor,
 *     capped at MAX_FETCH_PER_SYNC (oldest-first within the new range).
 *  4. Upsert headers; advance the stored uid_next cursor to live uidNext.
 */
export async function syncFolder(accountId, folder, { onProgress } = {}) {
  let newCount = 0

  await withLock(accountId, folder, async (client) => {
    // The lock object only carries { path, release }; live mailbox state
    // (UIDVALIDITY/uidNext/exists) lives on client.mailbox after the open.
    const mailbox = client.mailbox
    const liveValidity = mailbox && mailbox.uidValidity != null ? Number(mailbox.uidValidity) : null
    const liveUidNext = mailbox && mailbox.uidNext != null ? Number(mailbox.uidNext) : null
    const total = mailbox && mailbox.exists != null ? Number(mailbox.exists) : null

    const stored = Store.getFolder(accountId, folder)
    const plan = planFolderFetch({
      storedUidNext: stored?.uid_next ?? null,
      storedValidity: stored?.uid_validity ?? null,
      liveUidNext,
      liveValidity,
      total,
      max: MAX_FETCH_PER_SYNC,
    })
    // UIDVALIDITY changed → drop cached rows before reseeding newest-first.
    if (plan.wipe) Store.wipeFolder(accountId, folder)
    const { firstSync, range, rangeIsUid, cursorFloor } = plan

    // Already caught up: nothing new on an already-seeded folder. Advance the
    // stored cursor to the server's next-UID and return.
    if (plan.skip) {
      Store.upsertFolder({
        account_id: accountId,
        path: folder,
        name: stored?.name ?? folder,
        special_use: stored?.special_use ?? null,
        uid_validity: liveValidity ?? stored?.uid_validity ?? null,
        uid_next: liveUidNext,
        highest_modseq: stored?.highest_modseq ?? null,
        unseen: Store.countUnseen(accountId, folder),
        total: total ?? stored?.total ?? null,
      })
      return
    }

    const batch = []
    for await (const msg of (range == null ? [] : client.fetch(range, {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
    }, { uid: rangeIsUid }))) {
      const uid = Number(msg.uid)
      // On an incremental (UID) range, `cursor:*` can echo the highest message
      // even when none are new — guard against re-ingesting below the cursor.
      if (rangeIsUid && uid < cursorFloor) continue

      const env = msg.envelope || {}
      const flags = msg.flags || new Set()
      const seen = flags.has ? flags.has('\\Seen') : false
      const flagged = flags.has ? flags.has('\\Flagged') : false

      const from = envelopeAddrName(env.from)
      const dateTs = env.date ? new Date(env.date).getTime()
        : (msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now())

      const hasAttachments = detectAttachments(msg.bodyStructure)

      batch.push({
        account_id: accountId,
        folder,
        uid,
        message_id: env.messageId || null,
        in_reply_to: env.inReplyTo || null,
        refs: Array.isArray(env.references) ? env.references.join(' ') : (env.references || null),
        from_addr: from.address,
        from_name: from.name,
        to_addrs: envelopeAddrJoin(env.to),
        cc_addrs: envelopeAddrJoin(env.cc),
        subject: env.subject || '',
        date_ts: dateTs,
        seen,
        flagged,
        has_attachments: hasAttachments,
        snippet: '',
      })

      newCount += 1
      if (typeof onProgress === 'function' && newCount % 25 === 0) {
        try { onProgress({ accountId, folder, count: newCount }) } catch (_e) { /* noop */ }
      }
      if (batch.length >= MAX_FETCH_PER_SYNC) break
    }

    if (batch.length) Store.upsertMessageHeaders(batch)

    // Park the cursor for the next sync (see nextSyncCursor): first-sync jumps to
    // the server's next-UID; a capped incremental batch advances past what we got.
    const batchMaxUid = batch.reduce((m, r) => Math.max(m, r.uid), cursorFloor)
    const nextCursor = nextSyncCursor({
      firstSync,
      batchMaxUid,
      batchLen: batch.length,
      liveUidNext,
      cursorFloor,
      max: MAX_FETCH_PER_SYNC,
    })

    Store.upsertFolder({
      account_id: accountId,
      path: folder,
      name: stored?.name ?? folder,
      special_use: stored?.special_use ?? null,
      uid_validity: liveValidity ?? stored?.uid_validity ?? null,
      uid_next: nextCursor,
      highest_modseq: stored?.highest_modseq ?? null,
      unseen: Store.countUnseen(accountId, folder),
      total: total ?? stored?.total ?? null,
    })
  }, { readonly: true })

  // Warm the newest bodies in the background (detached) so the next click opens
  // instantly. Runs after the sync lock is released; de-duped per folder inside.
  void prefetchBodies(accountId, folder).catch(() => {})

  return { newCount }
}

function detectAttachments(bodyStructure) {
  if (!bodyStructure) return false
  let found = false
  const walk = (node) => {
    if (!node || found) return
    const disp = (node.disposition || '').toLowerCase()
    if (disp === 'attachment') { found = true; return }
    // Inline non-text parts with a filename also count as attachments.
    const type = (node.type || '').toLowerCase()
    if (node.dispositionParameters?.filename || node.parameters?.name) {
      if (!type.startsWith('text/') && type !== 'multipart') { found = true; return }
    }
    const kids = node.childNodes || node.children
    if (Array.isArray(kids)) kids.forEach(walk)
  }
  walk(bodyStructure)
  return found
}

/**
 * Return a full message. If the body is cached, serve it from the Store;
 * otherwise download the raw source, parse it, cache html/text + attachment
 * meta, and return. HTML is returned as-is (renderer sanitizes).
 */
export async function getMessage(accountId, folder, uid) {
  const numUid = Number(uid)
  const headerRow = Store.getMessageRow(accountId, folder, numUid)
  const cachedBody = Store.getBody(accountId, folder, numUid)

  if (cachedBody && (cachedBody.html != null || cachedBody.text != null)) {
    const atts = Store.listAttachmentMeta(accountId, folder, numUid).map((a) => ({
      partId: a.part_id,
      filename: a.filename,
      size: a.size,
      mime: a.mime,
    }))
    return assembleMessage(headerRow, numUid, cachedBody.html, cachedBody.text, atts)
  }

  // Download raw source and parse.
  const parsed = await withLock(accountId, folder, async (client) => {
    const { content } = await client.download(numUid, undefined, { uid: true })
    return simpleParser(content)
  }, { readonly: true })

  const html = parsed.html || (parsed.textAsHtml || null) || null
  const text = parsed.text || null

  // Persist body.
  Store.putBody({ accountId, folder, uid: numUid, html, text })

  // Attachment metadata (part_id keyed; mailparser numbers parts).
  const attMeta = (parsed.attachments || []).map((a, i) => ({
    partId: a.partId || a.cid || String(i + 1),
    filename: a.filename || `attachment-${i + 1}`,
    mime: a.contentType || 'application/octet-stream',
    size: a.size != null ? a.size : (a.content ? a.content.length : 0),
  }))
  if (attMeta.length) Store.putAttachmentMetas(accountId, folder, numUid, attMeta)

  // Keep header row's has_attachments in sync with reality.
  if (headerRow && !!headerRow.has_attachments !== (attMeta.length > 0)) {
    Store.upsertMessageHeader({
      ...headerRow,
      account_id: accountId,
      folder,
      uid: numUid,
      seen: headerRow.seen,
      flagged: headerRow.flagged,
      has_attachments: attMeta.length > 0,
    })
  }

  const atts = attMeta.map((a) => ({
    partId: a.partId, filename: a.filename, size: a.size, mime: a.mime,
  }))
  return assembleMessage(headerRow, numUid, html, text, atts, parsed)
}

/**
 * Warm the SQLite body cache for the newest un-cached messages in a folder, so
 * opening them is instant instead of a live IMAP download + parse. Reuses
 * getMessage (which downloads, parses, and persists body + attachment meta), runs
 * serially with a small gap so a user click can slip in ahead, swallows per-message
 * errors, and de-dupes concurrent passes per folder. Fire-and-forget; never throws.
 * @returns {Promise<{prefetched:number, skipped?:boolean}>}
 */
export async function prefetchBodies(accountId, folder, { limit = PREFETCH_BODIES } = {}) {
  const key = `${accountId}::${folder}`
  if (_prefetching.has(key)) return { prefetched: 0, skipped: true }
  _prefetching.add(key)
  let prefetched = 0
  try {
    const uids = Store.listMessagesNeedingBody({ accountId, folder, limit })
    for (const uid of uids) {
      try {
        await getMessage(accountId, folder, uid) // downloads + caches if missing
        prefetched += 1
      } catch (_e) { /* skip this one, keep warming the rest */ }
      if (PREFETCH_GAP_MS) await _sleep(PREFETCH_GAP_MS)
    }
  } catch (_e) { /* whole-pass failure is non-fatal */ } finally {
    _prefetching.delete(key)
  }
  return { prefetched }
}

function assembleMessage(headerRow, uid, html, text, attachments, parsed = null) {
  // Prefer parsed values when available (fresh fetch), fall back to header row.
  const from = parsed && parsed.from
    ? firstAddr(parsed.from)
    : { name: headerRow?.from_name || '', address: headerRow?.from_addr || '' }
  const to = parsed && parsed.to ? joinAddrs(parsed.to) : (headerRow?.to_addrs || '')
  const cc = parsed && parsed.cc ? joinAddrs(parsed.cc) : (headerRow?.cc_addrs || '')
  const subject = parsed && parsed.subject != null ? parsed.subject : (headerRow?.subject || '')
  const date = parsed && parsed.date
    ? new Date(parsed.date).getTime()
    : (headerRow?.date_ts || null)
  const messageId = parsed && parsed.messageId
    ? parsed.messageId
    : (headerRow?.message_id || null)
  const inReplyTo = parsed && parsed.inReplyTo
    ? parsed.inReplyTo
    : (headerRow?.in_reply_to || null)
  const references = parsed && parsed.references
    ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references)
    : (headerRow?.refs || null)

  return {
    uid,
    from,
    to,
    cc,
    subject,
    date,
    seen: headerRow ? !!headerRow.seen : true,
    flagged: headerRow ? !!headerRow.flagged : false,
    html,
    text,
    attachments,
    messageId,
    inReplyTo,
    references,
  }
}

/** Set/clear the \Seen flag, server-side then Store. */
export async function setSeen(accountId, folder, uid, seen) {
  const numUid = Number(uid)
  await withLock(accountId, folder, async (client) => {
    if (seen) await client.messageFlagsAdd(numUid, ['\\Seen'], { uid: true })
    else await client.messageFlagsRemove(numUid, ['\\Seen'], { uid: true })
  })
  Store.setFlag(accountId, folder, numUid, 'seen', !!seen)
}

/** Set/clear the \Flagged flag, server-side then Store. */
export async function setFlagged(accountId, folder, uid, flagged) {
  const numUid = Number(uid)
  await withLock(accountId, folder, async (client) => {
    if (flagged) await client.messageFlagsAdd(numUid, ['\\Flagged'], { uid: true })
    else await client.messageFlagsRemove(numUid, ['\\Flagged'], { uid: true })
  })
  Store.setFlag(accountId, folder, numUid, 'flagged', !!flagged)
}

/** Move a message to another folder; drop its local rows from the source. */
export async function move(accountId, folder, uid, toFolder) {
  const numUid = Number(uid)
  if (!toFolder || toFolder === folder) throw new Error('invalid destination folder')
  await withLock(accountId, folder, async (client) => {
    await client.messageMove(numUid, toFolder, { uid: true })
  })
  Store.removeMessage(accountId, folder, numUid)
}

/**
 * Delete a message. Prefer moving to Trash (gentler); if the folder IS Trash,
 * or no Trash exists, expunge permanently.
 */
export async function deleteMessage(accountId, folder, uid) {
  const numUid = Number(uid)
  const trash = findSpecialFolder(accountId, 'Trash')
  const inTrash = trash && trash.path === folder
  if (trash && !inTrash) {
    await withLock(accountId, folder, async (client) => {
      await client.messageMove(numUid, trash.path, { uid: true })
    })
  } else {
    await withLock(accountId, folder, async (client) => {
      await client.messageDelete(numUid, { uid: true })
    })
  }
  Store.removeMessage(accountId, folder, numUid)
}

function findSpecialFolder(accountId, specialUse) {
  const folders = Store.listFolders(accountId)
  return folders.find((f) => f.special_use === specialUse) || null
}

/**
 * Save an attachment to `targetPath`. The raw bytes are downloaded fresh by
 * partId; `targetPath` confinement is enforced by the IPC layer (must be inside
 * the directory chosen via the OS save dialog). Returns the absolute path.
 */
export async function saveAttachment(accountId, folder, uid, partId, targetPath) {
  const numUid = Number(uid)
  const abs = path.resolve(targetPath)

  const buffer = await withLock(accountId, folder, async (client) => {
    // Try a direct part download first (cheap); fall back to full-parse if the
    // server/part-id doesn't resolve.
    try {
      const dl = await client.download(numUid, String(partId), { uid: true })
      return await streamToBuffer(dl.content)
    } catch (_e) {
      const dl = await client.download(numUid, undefined, { uid: true })
      const parsed = await simpleParser(dl.content)
      const att = (parsed.attachments || []).find(
        (a, i) => (a.partId || a.cid || String(i + 1)) === String(partId),
      ) || (parsed.attachments || [])[0]
      if (!att || !att.content) throw new Error('attachment part not found')
      return Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content)
    }
  }, { readonly: true })

  fs.writeFileSync(abs, buffer)
  return abs
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/**
 * Server-side IMAP SEARCH within a folder (header/body match), returning header
 * rows pulled from the Store for any UIDs we already have; UIDs not yet cached
 * are fetched as headers on the fly. Falls back to a Store LIKE search on error.
 */
export async function searchFolder(accountId, folder, query) {
  const q = String(query || '').trim()
  if (!q) return []
  try {
    const rows = await withLock(accountId, folder, async (client) => {
      const uids = await client.search({ or: [{ subject: q }, { from: q }, { body: q }] }, { uid: true })
      if (!uids || !uids.length) return []
      // Limit to the newest 200 to keep payloads bounded.
      const wanted = uids.slice(-200)
      const result = []
      for (const uid of wanted) {
        let row = Store.getMessageRow(accountId, folder, Number(uid))
        if (!row) {
          // Pull a header for an uncached hit.
          // eslint-disable-next-line no-await-in-loop
          for await (const msg of client.fetch(String(uid), {
            uid: true, flags: true, envelope: true, internalDate: true, bodyStructure: true,
          }, { uid: true })) {
            const env = msg.envelope || {}
            const flags = msg.flags || new Set()
            const from = envelopeAddrName(env.from)
            const header = {
              account_id: accountId,
              folder,
              uid: Number(msg.uid),
              message_id: env.messageId || null,
              in_reply_to: env.inReplyTo || null,
              refs: Array.isArray(env.references) ? env.references.join(' ') : (env.references || null),
              from_addr: from.address,
              from_name: from.name,
              to_addrs: envelopeAddrJoin(env.to),
              cc_addrs: envelopeAddrJoin(env.cc),
              subject: env.subject || '',
              date_ts: env.date ? new Date(env.date).getTime()
                : (msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now()),
              seen: flags.has ? flags.has('\\Seen') : false,
              flagged: flags.has ? flags.has('\\Flagged') : false,
              has_attachments: detectAttachments(msg.bodyStructure),
              snippet: '',
            }
            Store.upsertMessageHeader(header)
            row = Store.getMessageRow(accountId, folder, Number(msg.uid))
          }
        }
        if (row) result.push(row)
      }
      return result
    }, { readonly: true })
    // Newest first.
    return rows.sort((a, b) => (b.date_ts || 0) - (a.date_ts || 0))
  } catch (_e) {
    // Offline / server SEARCH unsupported → local fallback.
    return Store.searchMessages(accountId, q, folder)
  }
}
