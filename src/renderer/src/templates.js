/**
 * Built-in page templates + a categorised template gallery.
 *
 * Opened via the `/template` slash command (which calls `onTemplate()` in
 * main.js → `templatePicker.open()`), or programmatically. A selected template
 * is inserted at the cursor in the active editor via `_insert`.
 *
 * Each template has a `category` so the gallery can group them. User-saved
 * templates ("save current page as template") are persisted via the
 * cross-platform settings bridge under `userTemplates` and shown in a "My
 * templates" category alongside the built-ins.
 */

const USER_TEMPLATES_KEY = 'userTemplates'

// Category ordering for the gallery.
export const TEMPLATE_CATEGORIES = ['Personal', 'Work', 'Engineering', 'Knowledge', 'Databases']

export const TEMPLATES = [
  {
    name: 'Meeting Notes',
    icon: '🗓️',
    category: 'Work',
    desc: 'Attendees, agenda, action items',
    content: `# Meeting Notes

**Date:**
**Attendees:**

## Agenda
-

## Notes
-

## Action Items
- [ ]
`,
  },
  {
    name: 'Daily Journal',
    icon: '📔',
    category: 'Personal',
    desc: 'Gratitude, focus, reflection',
    content: `# Daily Journal

## Today's focus
-

## Notes
-

## Grateful for
-

## Tomorrow
- [ ]
`,
  },
  {
    name: 'Project Plan',
    icon: '🚀',
    category: 'Work',
    desc: 'Goals, milestones, risks',
    content: `# Project Plan

## Overview


## Goals
-

## Milestones
| Milestone | Owner | Due |
|-----------|-------|-----|
|  |  |  |

## Risks
-
`,
  },
  {
    name: 'To-do List',
    icon: '✅',
    category: 'Personal',
    desc: 'Prioritised task list',
    content: `# To-do

## Today
- [ ]

## This week
- [ ]

## Someday
- [ ]
`,
  },
  {
    name: 'Task Board',
    icon: '🗂️',
    category: 'Databases',
    desc: 'Kanban database (To-do / Doing / Done)',
    content: '```database\n' + JSON.stringify({
      name: 'Tasks',
      columns: [
        { id: 'c1', name: 'Task', type: 'text' },
        { id: 'c2', name: 'Status', type: 'select', options: ['To-do', 'Doing', 'Done'] },
        { id: 'c3', name: 'Due', type: 'date' },
      ],
      rows: [{ c1: 'First task', c2: 'To-do', c3: '' }],
      views: [{ id: 'v1', type: 'board', name: 'Board', groupBy: 'c2' }],
      activeView: 'v1',
    }, null, 2) + '\n```\n',
  },
  {
    name: 'Reading Notes',
    icon: '📚',
    category: 'Knowledge',
    desc: 'Summary, highlights, takeaways',
    content: `# Reading Notes

**Title:**
**Author:**

## Summary


## Highlights
>

## Takeaways
-
`,
  },
  // ── Added templates ──────────────────────────────────────────────────────
  {
    name: 'Weekly Review',
    icon: '📅',
    category: 'Personal',
    desc: 'Wins, lessons, next-week plan',
    content: `# Weekly Review

**Week of:**

## Wins
-

## What didn't go well
-

## Lessons learned
-

## Plan for next week
- [ ]
`,
  },
  {
    name: 'Product Spec',
    icon: '📝',
    category: 'Work',
    desc: 'Problem, solution, requirements',
    content: `# Product Spec

## Problem
What problem are we solving, and for whom?

## Goals & non-goals
**Goals**
-

**Non-goals**
-

## Proposed solution


## Requirements
- [ ]

## Success metrics
-

## Open questions
-
`,
  },
  {
    name: 'OKRs',
    icon: '🎯',
    category: 'Work',
    desc: 'Objectives and key results',
    content: `# OKRs

**Quarter:**

## Objective 1:
- **KR1:**
- **KR2:**
- **KR3:**

## Objective 2:
- **KR1:**
- **KR2:**
- **KR3:**
`,
  },
  {
    name: 'Bug Report',
    icon: '🐞',
    category: 'Engineering',
    desc: 'Repro steps, expected vs actual',
    content: `# Bug Report

**Severity:**
**Environment:**

## Summary


## Steps to reproduce
1.
2.
3.

## Expected behaviour


## Actual behaviour


## Notes / logs
\`\`\`

\`\`\`
`,
  },
  {
    name: 'Wiki Home',
    icon: '📖',
    category: 'Knowledge',
    desc: 'Landing page for a knowledge base',
    content: `# 📖 Wiki Home

Welcome! This is the home of our knowledge base.

## Quick links
- [[Getting Started]]
- [[Glossary]]
- [[FAQ]]

## Sections
### Onboarding
-

### Processes
-

### References
-
`,
  },
  {
    name: 'Habit Tracker',
    icon: '📈',
    category: 'Personal',
    desc: 'Track daily habits across a week',
    content: `# Habit Tracker

| Habit | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|-------|-----|-----|-----|-----|-----|-----|-----|
| Exercise |  |  |  |  |  |  |  |
| Read |  |  |  |  |  |  |  |
| Meditate |  |  |  |  |  |  |  |
| Sleep 8h |  |  |  |  |  |  |  |
`,
  },
  {
    name: 'CRM',
    icon: '🤝',
    category: 'Databases',
    desc: 'Contacts/deals database (board view)',
    content: '```database\n' + JSON.stringify({
      name: 'CRM',
      columns: [
        { id: 'c1', name: 'Contact', type: 'text' },
        { id: 'c2', name: 'Company', type: 'text' },
        { id: 'c3', name: 'Stage', type: 'select', options: ['Lead', 'Contacted', 'Proposal', 'Won', 'Lost'] },
        { id: 'c4', name: 'Email', type: 'text' },
        { id: 'c5', name: 'Next step', type: 'text' },
      ],
      rows: [{ c1: 'Jane Doe', c2: 'Acme Inc', c3: 'Lead', c4: 'jane@acme.com', c5: 'Send intro email' }],
      views: [{ id: 'v1', type: 'board', name: 'Pipeline', groupBy: 'c3' }],
      activeView: 'v1',
    }, null, 2) + '\n```\n',
  },
]

// ── User templates (persisted) ────────────────────────────────────────────

let _userTemplates = []

export async function loadUserTemplates() {
  try {
    const raw = await window.api.getSettings(USER_TEMPLATES_KEY)
    if (Array.isArray(raw)) _userTemplates = raw
    else if (typeof raw === 'string' && raw) {
      try { _userTemplates = JSON.parse(raw) } catch { _userTemplates = [] }
    } else _userTemplates = []
  } catch (e) {
    console.warn('[Templates] load user templates failed:', e)
    _userTemplates = []
  }
  if (!Array.isArray(_userTemplates)) _userTemplates = []
  return _userTemplates.slice()
}

export function getUserTemplates() {
  return _userTemplates.slice()
}

async function persistUserTemplates() {
  try {
    await window.api.setSettings(USER_TEMPLATES_KEY, JSON.stringify(_userTemplates))
  } catch (e) {
    console.warn('[Templates] persist user templates failed:', e)
  }
}

export async function saveUserTemplate({ name, content, icon = '⭐', desc = '' } = {}) {
  if (!name || !content) return null
  const tpl = {
    id: `u_${Date.now().toString(36)}`,
    name,
    icon,
    desc: desc || 'My template',
    category: 'My templates',
    content,
    user: true,
  }
  _userTemplates.unshift(tpl)
  await persistUserTemplates()
  return tpl
}

export async function deleteUserTemplate(id) {
  const before = _userTemplates.length
  _userTemplates = _userTemplates.filter((t) => t.id !== id)
  if (_userTemplates.length !== before) { await persistUserTemplates(); return true }
  return false
}

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('template-gallery-styles')) return
  const style = document.createElement('style')
  style.id = 'template-gallery-styles'
  style.textContent = `
    .tg-category { margin-bottom: 20px; }
    .tg-category-title {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; color: #999; margin: 0 0 10px 2px;
    }
    .tg-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
    }
    .template-card {
      position: relative; text-align: left; border: 1px solid #eee; border-radius: 8px;
      padding: 14px; background: #fff; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
    }
    .template-card:hover { border-color: #2383e2; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .template-card-icon { font-size: 22px; margin-bottom: 8px; }
    .template-card-name { font-size: 13px; font-weight: 600; color: #333; }
    .template-card-desc { font-size: 11px; color: #999; margin-top: 4px; line-height: 1.35; }
    .template-card .tg-del {
      position: absolute; top: 8px; right: 8px; color: #ccc; font-size: 11px;
      opacity: 0; transition: opacity 0.15s; cursor: pointer;
    }
    .template-card:hover .tg-del { opacity: 1; }
    .template-card .tg-del:hover { color: #d9534f; }
    .template-modal { width: 760px; max-width: 92vw; max-height: 82vh; overflow: auto; }
    .tg-footer { margin-top: 8px; padding-top: 12px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
  `
  document.head.appendChild(style)
}

/**
 * Categorised template gallery. Backwards-compatible class name `TemplatePicker`
 * is preserved (main.js + slash command rely on `.open()` + `_insert`).
 */
export class TemplatePicker {
  constructor({ getView, getCurrentMarkdown, getCurrentTitle } = {}) {
    this.getView = getView || (() => null)
    // Optional hooks so "Save current page as template" can read the live doc.
    this.getCurrentMarkdown = getCurrentMarkdown || (() => (this.getView()?.state?.doc?.toString() || ''))
    this.getCurrentTitle = getCurrentTitle || (() => 'Template')
    this.overlay = null
    injectStyles()
  }

  /** All templates grouped by category (built-ins first, then user). */
  _grouped() {
    const all = [...TEMPLATES, ...getUserTemplates()]
    const groups = new Map()
    all.forEach((t) => {
      const cat = t.category || 'Other'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat).push(t)
    })
    // Stable ordering: known categories first, "My templates" last-ish, others between.
    const order = [...TEMPLATE_CATEGORIES, 'Other', 'My templates']
    const cats = Array.from(groups.keys()).sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
    return cats.map((c) => ({ category: c, items: groups.get(c) }))
  }

  async open() {
    await loadUserTemplates().catch(() => {})
    this.close()
    const overlay = document.createElement('div')
    overlay.className = 'template-overlay'
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close() })

    const modal = document.createElement('div')
    modal.className = 'template-modal'
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div class="template-modal-title" style="font-size:18px;font-weight:600;">Templates</div>
        <button class="btn btn-secondary" id="tg-save-current">Save current page as template</button>
      </div>
      <div id="tg-body"></div>
      <div class="tg-footer">Tip: type <code>/template</code> in the editor to open this gallery.</div>
    `
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    this.overlay = overlay

    const saveBtn = modal.querySelector('#tg-save-current')
    if (saveBtn) saveBtn.onclick = () => this._saveCurrentAsTemplate()

    this._renderBody()

    this._onKey = (e) => { if (e.key === 'Escape') this.close() }
    document.addEventListener('keydown', this._onKey)
  }

  _renderBody() {
    if (!this.overlay) return
    const body = this.overlay.querySelector('#tg-body')
    if (!body) return
    body.innerHTML = ''
    this._grouped().forEach(({ category, items }) => {
      const section = document.createElement('div')
      section.className = 'tg-category'
      const title = document.createElement('div')
      title.className = 'tg-category-title'
      title.textContent = category
      section.appendChild(title)

      const grid = document.createElement('div')
      grid.className = 'tg-grid'
      items.forEach((t) => {
        const card = document.createElement('button')
        card.className = 'template-card'
        card.innerHTML = `
          ${t.user ? '<i class="fas fa-times tg-del" title="Delete template"></i>' : ''}
          <div class="template-card-icon">${t.icon || '📄'}</div>
          <div class="template-card-name"></div>
          <div class="template-card-desc"></div>
        `
        card.querySelector('.template-card-name').textContent = t.name
        card.querySelector('.template-card-desc').textContent = t.desc || ''
        card.onclick = (e) => {
          if (e.target.classList && e.target.classList.contains('tg-del')) return
          this._insert(t); this.close()
        }
        if (t.user) {
          const del = card.querySelector('.tg-del')
          if (del) {
            del.onclick = async (e) => {
              e.stopPropagation()
              if (!confirm(`Delete template "${t.name}"?`)) return
              await deleteUserTemplate(t.id)
              this._renderBody()
            }
          }
        }
        grid.appendChild(card)
      })
      section.appendChild(grid)
      body.appendChild(section)
    })
  }

  async _saveCurrentAsTemplate() {
    let content = ''
    try { content = this.getCurrentMarkdown() } catch { content = '' }
    if (!content || !content.trim()) { alert('Open a page with some content first.'); return }
    let suggested = 'My template'
    try { suggested = this.getCurrentTitle() || suggested } catch { /* ignore */ }
    const name = prompt('Template name', suggested)
    if (!name || !name.trim()) return
    await saveUserTemplate({ name: name.trim(), content })
    this._renderBody()
  }

  _insert(template) {
    const view = this.getView()
    if (!view) return
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    const prefix = line.text.trim().length > 0 ? '\n\n' : ''
    const insert = prefix + template.content
    view.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: pos + insert.length },
    })
    view.focus()
  }

  close() {
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay)
    this.overlay = null
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null }
  }
}

// Alias for clarity; `TemplateGallery` and `TemplatePicker` are the same class.
export const TemplateGallery = TemplatePicker
