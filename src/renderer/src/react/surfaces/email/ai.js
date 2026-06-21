// ai.js — small helpers over host.ai (the shared Company Brain / Claude-Code).
//
// host.ai.ask(prompt, { onToken, onDone, onError, history }) → cancel()
// We wrap it two ways:
//   • askOnce()      → a Promise<fullText> for one-shot classification/JSON tasks.
//   • streamInto()   → fire-and-forget streaming with token/done/err callbacks,
//                      returning the cancel() fn so callers can abort.

export function aiAvailable(host) {
  try { return !!(host && host.ai && host.ai.available && host.ai.available()) } catch (_e) { return false }
}

// One-shot: resolves with the full completion text (or rejects on error).
export function askOnce(host, prompt, { history } = {}) {
  return new Promise((resolve, reject) => {
    if (!aiAvailable(host)) { reject(new Error('AI unavailable')); return }
    let acc = ''
    try {
      host.ai.ask(prompt, {
        history: history || [],
        onToken: (t) => { acc += t || '' },
        onDone: (full) => resolve(typeof full === 'string' && full.length ? full : acc),
        onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

// Streaming: returns cancel(). Calls onToken per chunk, onDone(full), onError(e).
export function streamInto(host, prompt, { onToken, onDone, onError, history } = {}) {
  if (!aiAvailable(host)) {
    if (onError) onError(new Error('AI unavailable'))
    return () => {}
  }
  let acc = ''
  try {
    return host.ai.ask(prompt, {
      history: history || [],
      onToken: (t) => { acc += t || ''; if (onToken) onToken(t || '', acc) },
      onDone: (full) => { if (onDone) onDone(typeof full === 'string' && full.length ? full : acc) },
      onError: (e) => { if (onError) onError(e instanceof Error ? e : new Error(String(e))) },
    })
  } catch (e) {
    if (onError) onError(e instanceof Error ? e : new Error(String(e)))
    return () => {}
  }
}

// ── prompt builders (kept here so wording is consistent + testable) ─────────────

export function summarizePrompt(threadText) {
  return (
    'Summarize this email thread for a busy professional. '
    + 'Reply with exactly one short headline line, then 3 concise bullet points '
    + 'covering the key context, any asks/requests, and any deadlines. '
    + 'No preamble.\n\n'
    + '--- EMAIL ---\n'
    + threadText
  )
}

export function replyDraftPrompt({ originalText, intent, tone = 'friendly, concise', inMyVoice = false }) {
  const voice = inMyVoice
    ? 'Write it in my personal voice — match the style, warmth, and sign-off I would naturally use. '
    : ''
  return (
    `Write a reply to the email below. Tone: ${tone}. ${voice}`
    + 'Output ONLY the reply body text (no subject line, no "Here is your reply", no quoting the original). '
    + 'You may draw on the user\'s notes/docs in the shared brain if relevant.\n\n'
    + `My intent for the reply: ${intent || 'acknowledge and respond appropriately'}\n\n`
    + '--- ORIGINAL EMAIL ---\n'
    + originalText
  )
}

export function composePrompt({ intent, tone = 'professional, concise', inMyVoice = false }) {
  const voice = inMyVoice ? 'Match my personal writing voice. ' : ''
  return (
    `Write an email. Tone: ${tone}. ${voice}`
    + 'Output ONLY the email body text (no subject, no preamble).\n\n'
    + `What I want to say: ${intent}`
  )
}

export function instantRepliesPrompt(originalText) {
  return (
    'Suggest 3 brief, distinct one-line replies to this email (e.g. an affirmative, '
    + 'a deferral, and a clarifying question where appropriate). '
    + 'Output exactly 3 lines, one reply per line, no numbering, no quotes.\n\n'
    + '--- EMAIL ---\n'
    + originalText
  )
}

export function triagePrompt(items) {
  // items: [{uid, from, subject}]
  const lines = items.map((m) => `${m.uid}\t${m.from}\t${m.subject}`).join('\n')
  return (
    'Classify each email below as "important" or "other". '
    + 'Important = needs the user\'s attention/action (real people, direct asks, time-sensitive). '
    + 'Other = newsletters, notifications, marketing, automated receipts. '
    + 'Respond ONLY with a JSON object mapping each uid (as a string) to "important" or "other". '
    + 'No prose.\n\n'
    + 'uid<TAB>from<TAB>subject:\n'
    + lines
  )
}

export function nlSearchPrompt(query) {
  return (
    'Convert this natural-language email search into a JSON filter. '
    + 'Keys (all optional): "from" (string), "subject" (string keywords), '
    + '"since" (ISO date string, e.g. "2026-06-01"), "unreadOnly" (boolean), '
    + '"text" (free-text keywords). Omit keys you cannot infer. '
    + 'Respond ONLY with the JSON object, nothing else.\n\n'
    + `Query: ${query}`
  )
}
