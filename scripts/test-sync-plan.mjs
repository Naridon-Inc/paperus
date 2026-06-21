/*
 * Pure unit + end-to-end test for the email sync planner (src/main/email/sync-plan.js).
 * No Electron, no SQLite, no network — proves the keystone behavior the user asked
 * for ("why is it showing only old emails?"): a fresh folder fetches the NEWEST N
 * messages, and subsequent syncs incrementally pick up only new mail.
 *
 *   node scripts/test-sync-plan.mjs
 */
import { planFolderFetch, nextSyncCursor } from '../src/main/email/sync-plan.js'

let pass = 0
let fail = 0
const eq = (got, want, label) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) { pass += 1 } else { fail += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`) }
}
const ok = (cond, label) => { if (cond) { pass += 1 } else { fail += 1; console.log(`  ✗ ${label}`) } }

const MAX = 500

// ── planFolderFetch ──────────────────────────────────────────────────────────
console.log('planFolderFetch:')

// 1. Fresh huge INBOX → newest 500 by SEQUENCE (this is the bug fix).
{
  const p = planFolderFetch({ storedUidNext: null, storedValidity: null, liveUidNext: 80000, liveValidity: 9, total: 73725, max: MAX })
  eq([p.firstSync, p.skip, p.wipe], [true, false, false], '1 fresh: firstSync, no skip/wipe')
  eq([p.range, p.rangeIsUid], ['73226:*', false], '1 fresh: SEQUENCE range = newest 500')
}
// 2. Fresh, server gives no count → UID window near the top.
{
  const p = planFolderFetch({ storedUidNext: null, storedValidity: null, liveUidNext: 80000, liveValidity: 9, total: 0, max: MAX })
  eq([p.range, p.rangeIsUid], ['79500:*', true], '2 fresh no-count: UID window newest ~500')
}
// 3. Fresh, no info at all → fetch nothing (safe).
{
  const p = planFolderFetch({ storedUidNext: null, storedValidity: null, liveUidNext: null, liveValidity: null, total: null, max: MAX })
  eq([p.firstSync, p.range], [true, null], '3 fresh no-info: range null')
}
// 4. Fresh SMALL mailbox (< max) → start clamps to seq 1 (all of it).
{
  const p = planFolderFetch({ storedUidNext: null, storedValidity: null, liveUidNext: 60, liveValidity: 9, total: 10, max: MAX })
  eq([p.range, p.rangeIsUid], ['1:*', false], '4 fresh small: whole mailbox by sequence')
}
// 5. Already seeded → incremental UID range from the cursor.
{
  const p = planFolderFetch({ storedUidNext: 79000, storedValidity: 9, liveUidNext: 80000, liveValidity: 9, total: 73725, max: MAX })
  eq([p.firstSync, p.range, p.rangeIsUid, p.cursorFloor], [false, '79000:*', true, 79000], '5 seeded: incremental UID range')
}
// 6. Seeded + caught up → skip (nothing new).
{
  const p = planFolderFetch({ storedUidNext: 80000, storedValidity: 9, liveUidNext: 80000, liveValidity: 9, total: 73725, max: MAX })
  eq([p.skip, p.range], [true, null], '6 caught up: skip')
}
// 7. UIDVALIDITY changed → wipe + reseed newest-first.
{
  const p = planFolderFetch({ storedUidNext: 79000, storedValidity: 111, liveUidNext: 80000, liveValidity: 222, total: 73725, max: MAX })
  eq([p.wipe, p.firstSync, p.range, p.rangeIsUid], [true, true, '73226:*', false], '7 uidvalidity change: wipe + newest-first seed')
}

// ── nextSyncCursor ───────────────────────────────────────────────────────────
console.log('nextSyncCursor:')
eq(nextSyncCursor({ firstSync: true, batchMaxUid: 79999, batchLen: 500, liveUidNext: 80000, cursorFloor: 0, max: MAX }), 80000, 'A firstSync → server next-UID')
eq(nextSyncCursor({ firstSync: true, batchMaxUid: 523, batchLen: 10, liveUidNext: null, cursorFloor: 0, max: MAX }), 524, 'B firstSync no next-UID → past batch')
eq(nextSyncCursor({ firstSync: true, batchMaxUid: 0, batchLen: 0, liveUidNext: null, cursorFloor: 0, max: MAX }), 1, 'C firstSync empty → 1')
eq(nextSyncCursor({ firstSync: false, batchMaxUid: 79999, batchLen: 500, liveUidNext: 90000, cursorFloor: 79000, max: MAX }), 80000, 'D incremental capped → past batch')
eq(nextSyncCursor({ firstSync: false, batchMaxUid: 79050, batchLen: 3, liveUidNext: 80000, cursorFloor: 79000, max: MAX }), 80000, 'E incremental normal → server next-UID')
eq(nextSyncCursor({ firstSync: false, batchMaxUid: 79000, batchLen: 0, liveUidNext: null, cursorFloor: 79000, max: MAX }), 79000, 'F incremental no-new → hold cursor')

// ── End-to-end: a mock IMAP mailbox driven through two real syncs ─────────────
console.log('end-to-end (mock mailbox, two syncs):')

// Build a server mailbox: 2000 messages, seq 1..2000, UID gaps, dates ascending.
// Oldest = 2022-01-01, newest = ~2026. This mirrors the user's 73k-deep INBOX.
function makeServer(n, startUid, startDateMs, stepMs) {
  const msgs = []
  let uid = startUid
  for (let i = 0; i < n; i += 1) {
    uid += 1 + (i % 3) // irregular UID gaps, still strictly increasing
    msgs.push({ seq: i + 1, uid, date: startDateMs + i * stepMs })
  }
  return msgs
}
function liveState(msgs, uidValidity = 42) {
  return { total: msgs.length, liveUidNext: msgs[msgs.length - 1].uid + 1, liveValidity: uidValidity }
}
// Mimic imapflow fetch semantics for 'A:*' / 'A:B' over seq or uid.
function mockFetch(msgs, range, isUid) {
  const [aRaw, bRaw] = range.split(':')
  const a = Number(aRaw)
  const exists = msgs.length
  const b = bRaw === '*' ? Infinity : Number(bRaw)
  return msgs
    .filter((m) => {
      const key = isUid ? m.uid : m.seq
      const hi = bRaw === '*' && !isUid ? exists : b
      return key >= a && key <= hi
    })
    .sort((x, y) => (isUid ? x.uid - y.uid : x.seq - y.seq))
}

// One sync step against the planner, returning the rows it would cache + cursor.
function runSync(server, stored, max) {
  const live = liveState(server)
  const plan = planFolderFetch({
    storedUidNext: stored.uid_next ?? null,
    storedValidity: stored.uid_validity ?? null,
    liveUidNext: live.liveUidNext,
    liveValidity: live.liveValidity,
    total: live.total,
    max,
  })
  if (plan.skip) return { fetched: [], nextCursor: live.liveUidNext, plan }
  let batch = plan.range == null ? [] : mockFetch(server, plan.range, plan.rangeIsUid)
  if (plan.rangeIsUid) batch = batch.filter((m) => m.uid >= plan.cursorFloor)
  if (batch.length > max) batch = batch.slice(0, max) // cap like the real loop's break
  const batchMaxUid = batch.reduce((m, r) => Math.max(m, r.uid), plan.cursorFloor)
  const nextCursor = nextSyncCursor({
    firstSync: plan.firstSync, batchMaxUid, batchLen: batch.length, liveUidNext: live.liveUidNext, cursorFloor: plan.cursorFloor, max,
  })
  return { fetched: batch, nextCursor, plan }
}

const D2022 = Date.UTC(2022, 0, 1)
const DAY = 86400000
let server = makeServer(2000, 1000, D2022, DAY) // ~5.5 years of daily mail
const serverNewestDate = server[server.length - 1].date

// SYNC 1 — fresh folder.
const s1 = runSync(server, {}, MAX)
const cache = new Map()
s1.fetched.forEach((m) => cache.set(m.uid, m))
const newestCached = Math.max(...[...cache.values()].map((m) => m.date))
const oldestCached = Math.min(...[...cache.values()].map((m) => m.date))

ok(s1.plan.firstSync === true, 'sync1 is firstSync')
ok(s1.fetched.length === MAX, `sync1 fetched exactly ${MAX} (got ${s1.fetched.length})`)
ok(newestCached === serverNewestDate, 'sync1 cached the NEWEST message (not the oldest)')
ok(oldestCached === server[server.length - MAX].date, 'sync1 window is the newest 500 by sequence')
ok(new Date(newestCached).getUTCFullYear() >= 2026, `sync1 newest is recent (${new Date(newestCached).toISOString().slice(0, 10)})`)
ok(!cache.has(server[0].uid), 'sync1 did NOT fetch the 2022 oldest message')
ok(s1.nextCursor === liveState(server).liveUidNext, 'sync1 parks cursor at server next-UID')

// SYNC 2 — 5 new messages arrive; incremental must grab exactly those.
const after = makeServer(5, server[server.length - 1].uid, serverNewestDate + DAY, DAY)
server = server.concat(after.map((m, i) => ({ ...m, seq: 2000 + i + 1 })))
const s2 = runSync(server, { uid_next: s1.nextCursor, uid_validity: 42 }, MAX)
s2.fetched.forEach((m) => cache.set(m.uid, m))

ok(s2.plan.firstSync === false, 'sync2 is incremental (not firstSync)')
ok(s2.fetched.length === 5, `sync2 fetched exactly the 5 new (got ${s2.fetched.length})`)
ok(Math.max(...[...cache.values()].map((m) => m.date)) === server[server.length - 1].date, 'sync2 cached the brand-new newest message')

// SYNC 3 — nothing new → skip, cache unchanged.
const s3 = runSync(server, { uid_next: s2.nextCursor, uid_validity: 42 }, MAX)
ok(s3.plan.skip === true, 'sync3 with no new mail → skip')
ok(s3.fetched.length === 0, 'sync3 fetched nothing')

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
