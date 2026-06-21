import { definePlugin } from '@notionless/plugin-sdk'

/**
 * {{name}} — {{description}}
 *
 * A minimal Paperus plugin. Grow it by registering contributions on `ctx`
 * inside activate(). See docs/PLUGIN_API_CONTRACT.md for the full ctx API.
 */
export default definePlugin({
  async activate(ctx) {
    this._disposables = []
    ctx.ui.notify({ message: '{{name}} activated', kind: 'info', timeout: 2000 })
  },

  async deactivate() {
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  },
})
