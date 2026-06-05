import { definePlugin } from '@notionless/plugin-sdk'

/**
 * AI Summarize — exercises `ctx.commands.register`, `ctx.ai.complete` (with
 * streamed `onToken`), and a `ctx.ui.panel` whose vDOM is re-rendered as tokens
 * arrive via the panel's `update(vdom)`.
 *
 * Capabilities: ["commands", "ai", "ui", "editor"]
 *
 * The AI call runs host-side against the user's configured rag-engine backend.
 * The plugin never sees the API key/endpoint/model — only streamed tokens.
 */

const SYSTEM = [
  'You are a concise note summarizer.',
  'Produce 3-5 short bullet points capturing the key ideas of the note.',
  'Output plain text bullets starting with "- ". No preamble.',
].join(' ')

/** Build the panel vDOM for a given state. */
function panelVDOM(state) {
  const children = [
    {
      tag: 'div',
      attrs: { class: 'ai-summary-head' },
      children: [
        { tag: 'strong', children: ['Summary'] },
        {
          tag: 'button',
          attrs: { class: 'ai-summary-refresh', type: 'button', title: 'Regenerate' },
          on: { click: 'regenerate' },
          children: ['↻'],
        },
      ],
    },
  ]

  if (state.status === 'idle') {
    children.push({ tag: 'p', attrs: { class: 'ai-summary-empty' }, children: ['Run "Summarize note" to generate a summary.'] })
  } else if (state.status === 'loading') {
    children.push({ tag: 'p', attrs: { class: 'ai-summary-status' }, children: ['Summarizing…'] })
    if (state.text) children.push({ tag: 'pre', attrs: { class: 'ai-summary-text' }, children: [state.text] })
  } else if (state.status === 'error') {
    children.push({ tag: 'p', attrs: { class: 'ai-summary-error' }, children: [state.error || 'Something went wrong.'] })
  } else {
    children.push({ tag: 'pre', attrs: { class: 'ai-summary-text' }, children: [state.text || '(empty)'] })
  }

  return { tag: 'div', attrs: { class: 'ai-summary-panel' }, children }
}

export default definePlugin({
  async activate(ctx) {
    this._disposables = []
    this._state = { status: 'idle', text: '', error: '' }

    // Right-side panel that displays the streamed summary.
    const panel = ctx.ui.panel({
      id: 'summary',
      title: 'Summary',
      location: 'right',
      render: () => panelVDOM(this._state),
      onEvent: (e) => {
        if (e.action === 'regenerate') this._run()
      },
    })
    this._panel = panel
    this._disposables.push(panel)

    const repaint = () => {
      try { panel.update(panelVDOM(this._state)) } catch { /* ignore */ }
    }
    this._repaint = repaint

    // The actual summarize routine, shared by the command + the panel button.
    this._run = async () => {
      let active
      try {
        active = await ctx.editor.getActive()
      } catch {
        active = null
      }
      const noteText = active && active.text ? active.text : ''
      if (!noteText.trim()) {
        this._state = { status: 'error', text: '', error: 'No note is open to summarize.' }
        repaint()
        ctx.ui.notify({ message: 'No note open to summarize', kind: 'warn' })
        return
      }

      this._state = { status: 'loading', text: '', error: '' }
      repaint()

      try {
        const { text } = await ctx.ai.complete({
          system: SYSTEM,
          prompt: `Summarize this note:\n\n${noteText}`,
          onToken: (t) => {
            // Stream tokens into the panel as they arrive.
            this._state = { status: 'loading', text: (this._state.text || '') + t, error: '' }
            repaint()
          },
        })
        this._state = { status: 'done', text: text || this._state.text || '', error: '' }
        repaint()
      } catch (err) {
        this._state = {
          status: 'error',
          text: this._state.text || '',
          error: (err && err.message) ? err.message : 'AI request failed.',
        }
        repaint()
        ctx.ui.notify({ message: 'Summarize failed', kind: 'error' })
      }
    }

    // Register the command (also bound to Mod-Shift-S via the manifest key).
    const cmd = ctx.commands.register({
      id: 'summarize',
      title: 'Summarize note',
      key: 'Mod-Shift-S',
      when: 'editorFocus',
      run: () => this._run(),
    })
    this._disposables.push(cmd)
  },

  async deactivate() {
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  },
})
