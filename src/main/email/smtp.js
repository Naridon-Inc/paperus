/**
 * Email subsystem — SMTP send layer (nodemailer) + Sent-folder APPEND.
 *
 * `getTransport(accountId)` builds a cached `nodemailer` transport from the
 * account row + decrypted password (TLS enforced, `rejectUnauthorized:true`).
 * `verifyTransport` runs nodemailer's handshake check (used by accountTest).
 * `sendMail(accountId, draft)` sends a message (with In-Reply-To / References /
 * attachments) and then APPENDs the produced RFC822 source to the account's Sent
 * mailbox via ImapFlow, so sent mail shows up like any other client. Returns
 * `{ messageId }`.
 *
 * The decrypted password stays inside the transport config in main-process
 * memory; it is never returned or logged.
 */

import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { buildConnectionConfig } from './accounts.js'
import { getClient } from './pool.js'
import { Store } from './store.js'

// accountId -> nodemailer transport
const transports = new Map()

function makeTransport(cfg) {
  const secure = cfg.smtp.secure !== false
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure, // true => implicit TLS (465). false => STARTTLS upgrade required below.
    requireTLS: !secure, // force STARTTLS when not implicit-TLS; never send plaintext.
    auth: {
      user: cfg.auth.user,
      pass: cfg.auth.pass,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
  })
}

/** Get (or build) the cached transport for an account. */
export function getTransport(accountId) {
  const existing = transports.get(accountId)
  if (existing) return existing
  const cfg = buildConnectionConfig(accountId)
  if (!cfg) throw new Error('account config or password missing')
  if (!cfg.smtp.host) throw new Error('SMTP host not configured')
  const tx = makeTransport(cfg)
  transports.set(accountId, tx)
  return tx
}

/** Drop a cached transport (e.g. on account update/remove). */
export function closeTransport(accountId) {
  const tx = transports.get(accountId)
  if (tx) {
    try { tx.close() } catch (_e) { /* noop */ }
    transports.delete(accountId)
  }
}

export function closeAllTransports() {
  for (const [, tx] of transports) {
    try { tx.close() } catch (_e) { /* noop */ }
  }
  transports.clear()
}

/**
 * Verify SMTP credentials/connectivity from an ad-hoc config (used by
 * accountTest BEFORE the account is persisted). Builds a throwaway transport
 * from the raw renderer config and closes it.
 */
export async function verifyConfig(config) {
  const c = config || {}
  const secure = c.smtpSecure !== false
  const tx = nodemailer.createTransport({
    host: c.smtpHost,
    port: Number(c.smtpPort) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure,
    auth: { user: c.username || c.email, pass: c.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  })
  try {
    await tx.verify()
    return true
  } finally {
    try { tx.close() } catch (_e) { /* noop */ }
  }
}

function buildMailOptions(cfg, draft) {
  const d = draft || {}
  const fromName = cfg.name || ''
  const fromAddr = cfg.email || cfg.auth.user
  const opts = {
    from: fromName ? { name: fromName, address: fromAddr } : fromAddr,
    to: normalizeRecipients(d.to),
    cc: normalizeRecipients(d.cc),
    bcc: normalizeRecipients(d.bcc),
    subject: d.subject || '',
    text: d.text || undefined,
    html: d.html || undefined,
  }
  if (d.inReplyTo) opts.inReplyTo = d.inReplyTo
  if (d.references) {
    opts.references = Array.isArray(d.references) ? d.references.join(' ') : d.references
  }
  if (Array.isArray(d.attachments) && d.attachments.length) {
    opts.attachments = d.attachments.map((a) => {
      const att = { filename: a.filename }
      if (a.path) att.path = a.path
      else if (a.content != null) {
        // content may arrive base64-encoded from the renderer.
        att.content = a.encoding === 'base64' ? Buffer.from(a.content, 'base64') : a.content
      }
      if (a.contentType || a.mime) att.contentType = a.contentType || a.mime
      if (a.cid) att.cid = a.cid
      return att
    })
  }
  // Ensure at least one body part.
  if (opts.text === undefined && opts.html === undefined) opts.text = ''
  return opts
}

function normalizeRecipients(v) {
  if (v == null) return undefined
  if (Array.isArray(v)) {
    const list = v.map(stringifyRecipient).filter(Boolean)
    return list.length ? list : undefined
  }
  const s = stringifyRecipient(v)
  return s || undefined
}

function stringifyRecipient(r) {
  if (!r) return ''
  if (typeof r === 'string') return r.trim()
  if (typeof r === 'object' && r.address) {
    return r.name ? `${r.name} <${r.address}>` : r.address
  }
  return ''
}

/** Compile a draft to a raw RFC822 Buffer (so the Sent copy == what we sent). */
function compileRaw(mailOptions) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer(mailOptions)
    composer.compile().build((err, message) => {
      if (err) reject(err)
      else resolve(message)
    })
  })
}

/**
 * Send a draft and append the raw message to the account's Sent folder.
 * Returns { messageId }. The message is compiled ONCE to raw RFC822 and that
 * exact buffer is both transmitted (via the `raw` option) and APPENDed to Sent,
 * so the archived copy is byte-identical to what the recipient receives.
 * Append failures are non-fatal (the message was already sent) and swallowed so
 * servers without an APPENDable Sent folder still work.
 */
export async function sendMail(accountId, draft) {
  const cfg = buildConnectionConfig(accountId)
  if (!cfg) throw new Error('account config or password missing')

  const tx = getTransport(accountId)
  const mailOptions = buildMailOptions(cfg, draft)

  // Compile once so the wire copy and the Sent copy match exactly.
  const raw = await compileRaw(mailOptions)

  // The real Message-ID is the one MailComposer embedded in `raw` (that's what
  // the recipient and the Sent copy carry). nodemailer would synthesize a
  // different id for its info object when handed `raw`, so we read it back from
  // the buffer for an accurate return value and threading.
  const messageId = extractMessageId(raw)

  // We pass an explicit envelope so Bcc recipients (stripped from the visible
  // headers by MailComposer) are still delivered. `raw` carries the exact bytes.
  await tx.sendMail({
    envelope: {
      from: cfg.email || cfg.auth.user,
      to: collectEnvelopeRecipients(mailOptions),
    },
    raw,
  })

  // APPEND the produced source to Sent (best-effort).
  try {
    const sent = findSentFolder(accountId)
    if (sent) {
      const client = await getClient(accountId)
      await client.append(sent.path, raw, ['\\Seen'])
    }
  } catch (_e) {
    // Non-fatal: the mail was sent even if it couldn't be archived to Sent.
  }

  return { messageId }
}

/** Flatten to/cc/bcc into a single recipient list for the SMTP envelope. */
function collectEnvelopeRecipients(mailOptions) {
  const out = []
  for (const key of ['to', 'cc', 'bcc']) {
    const v = mailOptions[key]
    if (!v) continue
    if (Array.isArray(v)) out.push(...v)
    else out.push(v)
  }
  return out
}

/** Best-effort Message-ID parse from a raw buffer (fallback for return value). */
function extractMessageId(raw) {
  try {
    const head = raw.toString('utf8', 0, Math.min(raw.length, 8192))
    const m = head.match(/^message-id:\s*(<[^>]+>)/im)
    return m ? m[1] : null
  } catch (_e) {
    return null
  }
}

function findSentFolder(accountId) {
  const folders = Store.listFolders(accountId)
  return folders.find((f) => f.special_use === 'Sent') || null
}
