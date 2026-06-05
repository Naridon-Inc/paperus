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

const readOnlyComp = new Compartment()

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

export function createEditor(parent, options = {}) {
  const extensions = [
    readOnlyComp.of(EditorState.readOnly.of(false)),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(markdownHighlight),
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
