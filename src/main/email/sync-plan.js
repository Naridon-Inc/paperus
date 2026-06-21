/**
 * Pure IMAP sync planning — no Electron, no SQLite, no network. Isolated here so
 * the newest-first seeding logic is unit-testable in plain Node
 * (see scripts/test-sync-plan.mjs). imap.js consumes both functions.
 */

/**
 * Decide WHAT to fetch for a folder sync, purely from the stored cursor + live
 * mailbox state. Returns:
 *   { firstSync, wipe, skip, range, rangeIsUid, cursorFloor }
 *  - firstSync   → this folder has no UID cursor yet (or was just invalidated)
 *  - wipe        → drop cached rows first (UIDVALIDITY changed)
 *  - skip        → already caught up; just advance the cursor and return
 *  - range       → imapflow fetch range string (null = fetch nothing)
 *  - rangeIsUid  → true: UID set; false: SEQUENCE set (the newest-first seed)
 *  - cursorFloor → guard so an incremental `cursor:*` ignores the echoed boundary
 *
 * First sync of a folder seeds the NEWEST `max` messages by SEQUENCE number
 * (1..exists is contiguous, so `exists-max+1:*` is exactly the most recent
 * `max`, regardless of UID gaps) — this is what makes a fresh mailbox open on
 * today's mail instead of its oldest. Subsequent syncs walk forward by UID from
 * the stored high-water cursor.
 */
export function planFolderFetch({ storedUidNext, storedValidity, liveUidNext, liveValidity, total, max }) {
  let cursor = storedUidNext == null ? null : Number(storedUidNext)
  let firstSync = cursor == null
  let wipe = false
  if (storedValidity != null && liveValidity != null && Number(storedValidity) !== Number(liveValidity)) {
    wipe = true
    cursor = null
    firstSync = true
  }
  // Already seeded and caught up → nothing new; caller just bumps the cursor.
  if (!firstSync && liveUidNext != null && cursor >= liveUidNext) {
    return { firstSync, wipe, skip: true, range: null, rangeIsUid: true, cursorFloor: cursor }
  }
  let range = null
  let rangeIsUid = true
  if (firstSync) {
    if (total != null && total > 0) {
      const startSeq = Math.max(1, total - max + 1)
      range = `${startSeq}:*`
      rangeIsUid = false
    } else if (liveUidNext != null && liveUidNext > 1) {
      // No message count from the server — approximate "newest max" by UID window.
      cursor = Math.max(1, liveUidNext - max)
      range = `${cursor}:*`
      rangeIsUid = true
    }
  } else {
    range = `${cursor}:*`
    rangeIsUid = true
  }
  return { firstSync, wipe, skip: false, range, rangeIsUid, cursorFloor: cursor == null ? 0 : cursor }
}

/**
 * Where to park the cursor AFTER a sync, so the next sync only pulls new mail.
 *  - firstSync (newest-first seed) → jump to the server's next-UID.
 *  - capped incremental batch       → just past the highest fetched UID.
 *  - normal incremental             → server next-UID (or just past the batch).
 */
export function nextSyncCursor({ firstSync, batchMaxUid, batchLen, liveUidNext, cursorFloor, max }) {
  if (firstSync) {
    if (liveUidNext != null) return liveUidNext
    return batchLen ? batchMaxUid + 1 : (cursorFloor || 1)
  }
  if (batchLen >= max) return batchMaxUid + 1
  if (liveUidNext != null) return liveUidNext
  return batchLen ? batchMaxUid + 1 : cursorFloor
}
