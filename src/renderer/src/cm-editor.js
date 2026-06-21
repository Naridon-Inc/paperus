import { EditorView, keymap, placeholder, drawSelection, highlightActiveLine } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import {
  closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap,
} from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import { livePreview } from './cm-hide-markers'
import { mentionCompletionSource } from './cm-mention'
import { suggestModeTransactionFilter } from './cm-suggest'
import { focusMode } from './cm-focus'

const readOnlyComp = new Compartment()
// Swaps the markdown highlight palette (light <-> dark) live when the app theme
// changes, without tearing down the editor.
const themeComp = new Compartment()

// Custom highlight style that makes markdown look like a document, not code
const markdownHighlight = HighlightStyle.define([
  // Headings — large, bold, colored
  { tag: tags.heading1, fontSize: '1.8em', fontWeight: '700', color: '#1a1a1a', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '1.4em', fontWeight: '650', color: '#2a2a2a', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '1.2em', fontWeight: '600', color: '#333', lineHeight: '1.4' },
  { tag: tags.heading4, fontSize: '1.05em', fontWeight: '600', color: '#444' },
  { tag: tags.heading5, fontSize: '1em', fontWeight: '600', color: '#555' },
  { tag: tags.heading6, fontSize: '0.95em', fontWeight: '600', color: '#666' },

  // Emphasis
  { tag: tags.strong, fontWeight: '700', color: '#1a1a1a' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#333' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#999' },

  // Code
  { tag: tags.monospace, fontFamily: '"SF Mono", Monaco, Menlo, Consolas, monospace', fontSize: '0.88em', color: '#d14', backgroundColor: '#f7f7f7', borderRadius: '3px' },

  // Links
  { tag: tags.link, color: '#2383e2', textDecoration: 'underline' },
  { tag: tags.url, color: '#2383e2' },

  // Quotes
  { tag: tags.quote, color: '#6a737d', fontStyle: 'italic' },

  // Lists
  { tag: tags.list, color: '#333' },

  // Metadata / processing instructions (front matter, etc.)
  { tag: tags.meta, color: '#999' },
  { tag: tags.processingInstruction, color: '#999' },

  // The markdown syntax markers (#, **, `, etc.) — make them subtle
  { tag: tags.contentSeparator, color: '#ccc' },

  // Comment (HTML comments in markdown)
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },

  // Fallback for any other code tokens
  { tag: tags.keyword, color: '#d73a49' },
  { tag: tags.string, color: '#032f62' },
  { tag: tags.number, color: '#005cc5' },
  { tag: tags.operator, color: '#d73a49' },
  { tag: tags.variableName, color: '#e36209' },
  { tag: tags.typeName, color: '#6f42c1' },
  { tag: tags.className, color: '#6f42c1' },
  { tag: tags.function(tags.variableName), color: '#6f42c1' },
  { tag: tags.definition(tags.variableName), color: '#005cc5' },
  { tag: tags.propertyName, color: '#005cc5' },
  { tag: tags.labelName, color: '#e36209' },
  { tag: tags.bool, color: '#005cc5' },
  { tag: tags.null, color: '#005cc5' },
  { tag: tags.regexp, color: '#032f62' },
  { tag: tags.atom, color: '#005cc5' },
])

// Dark counterpart — same structure, palette tuned for a deep-grey canvas.
// Headings/strong stay near-white; code/links/keywords use brighter, cooler
// hues so they read on #1d1e21 without glaring.
const markdownHighlightDark = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.8em', fontWeight: '700', color: '#f1f2f4', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '1.4em', fontWeight: '650', color: '#e6e7ea', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '1.2em', fontWeight: '600', color: '#dadce0', lineHeight: '1.4' },
  { tag: tags.heading4, fontSize: '1.05em', fontWeight: '600', color: '#c9ccd2' },
  { tag: tags.heading5, fontSize: '1em', fontWeight: '600', color: '#b6b9c0' },
  { tag: tags.heading6, fontSize: '0.95em', fontWeight: '600', color: '#9aa0a8' },

  { tag: tags.strong, fontWeight: '700', color: '#f1f2f4' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#dadce0' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#7a7f88' },

  { tag: tags.monospace, fontFamily: '"SF Mono", Monaco, Menlo, Consolas, monospace', fontSize: '0.88em', color: '#ff9db0', backgroundColor: '#26282d', borderRadius: '3px' },

  { tag: tags.link, color: '#6e9bff', textDecoration: 'underline' },
  { tag: tags.url, color: '#6e9bff' },

  { tag: tags.quote, color: '#9aa0a8', fontStyle: 'italic' },
  { tag: tags.list, color: '#c9ccd2' },

  { tag: tags.meta, color: '#6b6f78' },
  { tag: tags.processingInstruction, color: '#5a5e66' },
  { tag: tags.contentSeparator, color: '#4a4d54' },
  { tag: tags.comment, color: '#8b8f98', fontStyle: 'italic' },

  // Fenced-code syntax palette (GitHub-dark-ish)
  { tag: tags.keyword, color: '#ff7b72' },
  { tag: tags.string, color: '#a5d6ff' },
  { tag: tags.number, color: '#79c0ff' },
  { tag: tags.operator, color: '#ff7b72' },
  { tag: tags.variableName, color: '#ffa657' },
  { tag: tags.typeName, color: '#d2a8ff' },
  { tag: tags.className, color: '#d2a8ff' },
  { tag: tags.function(tags.variableName), color: '#d2a8ff' },
  { tag: tags.definition(tags.variableName), color: '#79c0ff' },
  { tag: tags.propertyName, color: '#79c0ff' },
  { tag: tags.labelName, color: '#ffa657' },
  { tag: tags.bool, color: '#79c0ff' },
  { tag: tags.null, color: '#79c0ff' },
  { tag: tags.regexp, color: '#a5d6ff' },
  { tag: tags.atom, color: '#79c0ff' },
])

// A tiny EditorView theme to flip CM's own surfaces (cursor, gutters bg) for
// dark. Most editor chrome is styled in theme-dark.css via #editor, but the
// caret + drop cursor live inside the view, so set them here too.
const cmDarkTheme = EditorView.theme({
  '&': { color: '#e6e7ea' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6e9bff' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(91,140,255,0.30)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(91,140,255,0.30)' },
}, { dark: true })

// Resolve the current app theme from <html data-theme>. We avoid importing
// theme.js to keep this module dependency-light; the dataset is the contract.
function isDarkTheme() {
  try { return document.documentElement.dataset.theme === 'dark' } catch (_e) { return false }
}

// The extension set the theme compartment holds for a given mode.
function themeExtFor(dark) {
  return dark
    ? [syntaxHighlighting(markdownHighlightDark), cmDarkTheme]
    : [syntaxHighlighting(markdownHighlight)]
}

export function createEditor(parent, options = {}) {
  const extensions = [
    readOnlyComp.of(EditorState.readOnly.of(false)),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    // Theme palette lives in a compartment so it can hot-swap on theme:changed.
    themeComp.of(themeExtFor(isDarkTheme())),
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    closeBrackets(),
    // @-mention / @-date autocomplete — self-registers, no main.js wiring needed.
    autocompletion({ override: [mentionCompletionSource], defaultKeymap: false }),
    // Suggestion-mode (track-changes) auto-wrap. Inert unless toggleSuggestMode().
    suggestModeTransactionFilter,
    history(),
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    placeholder(options.placeholder || 'Start writing...'),
    livePreview,
    // Focus / Zen writing mode — inert until toggled via toggleFocusMode().
    focusMode,
  ]

  if (options.extensions) {
    extensions.push(...options.extensions)
  }

  const view = new EditorView({
    state: EditorState.create({
      doc: options.doc || '',
      extensions,
    }),
    parent,
  })

  // Hot-swap the editor palette when the app theme flips, without rebuilding
  // the editor or losing CRDT/undo state. Detach on destroy to avoid leaks.
  const onThemeChanged = (e) => {
    const dark = e && e.detail && e.detail.theme
      ? e.detail.theme === 'dark'
      : isDarkTheme()
    view.dispatch({ effects: themeComp.reconfigure(themeExtFor(dark)) })
  }
  window.addEventListener('theme:changed', onThemeChanged)
  const origDestroy = view.destroy.bind(view)
  view.destroy = () => {
    window.removeEventListener('theme:changed', onThemeChanged)
    origDestroy()
  }

  return view
}

export function getText(view) {
  return view.state.doc.toString()
}

export function setText(view, text) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  })
}

export function setReadOnly(view, readOnly) {
  if (!view) return
  view.dispatch({
    effects: readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
  })
}

export function insertAtCursor(view, text) {
  const cursor = view.state.selection.main.head
  view.dispatch({
    changes: { from: cursor, insert: text },
    selection: { anchor: cursor + text.length },
  })
}

export function getSelection(view) {
  const sel = view.state.selection.main
  return { from: sel.from, to: sel.to }
}
