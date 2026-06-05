import { definePlugin } from '@notionless/plugin-sdk'

/**
 * Word Count — exercises `ctx.ui.statusItem` (footer) + `ctx.editor.onChange`
 * and the initial-state read via `ctx.editor.getActive`.
 *
 * Capabilities: ["editor", "ui"]
 *
 * This example is part of the API acceptance test: it must light up a footer
 * status slot and keep it current as the active document changes.
 */

/** Count words (whitespace-delimited runs of non-space) and characters. */
function countText(text) {
  const t = typeof text === 'string' ? text : ''
  const words = (t.trim().match(/\S+/g) || []).length
  const chars = t.length
  return { words, chars }
}

function format({ words, chars }) {
  const w = words === 1 ? '1 word' : `${words} words`
  const c = chars === 1 ? '1 char' : `${chars} chars`
  return `${w} · ${c}`
}

export default definePlugin({
  async activate(ctx) {
    this._disposables = []

    // Create the footer status item declared in plugin.json. The handle exposes
    // set(text | { html }).
    const status = ctx.ui.statusItem({ id: 'word-count', location: 'footer' })
    this._disposables.push(status)

    const update = (text) => {
      try {
        status.set(format(countText(text)))
      } catch (err) {
        // Never throw out of a host callback.
        status.set('— words')
      }
    }

    // Live updates as the user types.
    const offChange = ctx.editor.onChange(({ text }) => update(text))
    this._disposables.push(offChange)

    // Re-count when a different note is opened.
    const offOpen = ctx.events.on('note:open', async () => {
      const active = await ctx.editor.getActive()
      update(active ? active.text : '')
    })
    this._disposables.push(offOpen)

    // Seed with the currently active doc, if any.
    const active = await ctx.editor.getActive()
    update(active ? active.text : '')
  },

  async deactivate() {
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  },
})
