import { definePlugin } from '@notionless/plugin-sdk'

/**
 * {{name}} — live word/char count in the footer status bar.
 * Capabilities: ["editor", "ui"]
 */

function countText(text) {
  const t = typeof text === 'string' ? text : ''
  const words = (t.trim().match(/\S+/g) || []).length
  return { words, chars: t.length }
}

function format({ words, chars }) {
  const w = words === 1 ? '1 word' : `${words} words`
  const c = chars === 1 ? '1 char' : `${chars} chars`
  return `${w} · ${c}`
}

export default definePlugin({
  async activate(ctx) {
    this._disposables = []

    const status = ctx.ui.statusItem({ id: 'word-count', location: 'footer' })
    this._disposables.push(status)

    const update = (text) => {
      try { status.set(format(countText(text))) } catch { status.set('— words') }
    }

    this._disposables.push(ctx.editor.onChange(({ text }) => update(text)))
    this._disposables.push(ctx.events.on('note:open', async () => {
      const active = await ctx.editor.getActive()
      update(active ? active.text : '')
    }))

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
