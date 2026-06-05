// Standalone harness: mounts the REAL CodeMirror editor (with the livePreview
// decorations) outside the app shell, loads a document exercising every new
// block type, and signals readiness so a headless browser can screenshot it.
import { createEditor, setText } from '@/cm-editor'
import '@/style.css'

const SAMPLE = `---
icon: 🚀
title: Feature Demo
---

# Notionless Feature Demo

Paragraph with **bold**, *italic*, \`inline code\`, ==highlighted==, and ==green:colored== text.

## Callouts

> [!note] Note callout
> This is a note body.

> [!warning] Heads up
> Careful here.

> [!success] Done
> It worked.

## Math

Inline $E = mc^2$ and a block equation:

$$\\int_0^\\infty e^{-x}\\,dx = 1$$

## Mermaid

\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[Stop]
\`\`\`

## Table

| Name | Status |
|------|--------|
| Task 1 | Done |
| Task 2 | Todo |

## Database

\`\`\`database
{"columns":[{"id":"c1","name":"Name","type":"text"},{"id":"c2","name":"Status","type":"select","options":["Todo","Done"]}],"rows":[{"id":"r1","c1":"First","c2":"Todo"},{"id":"r2","c1":"Second","c2":"Done"}],"views":[{"id":"v1","name":"Table","type":"table"}],"activeView":"v1"}
\`\`\`

## Toggle

<details><summary>Click to expand</summary>
Hidden content inside the toggle.
</details>

## Table of contents

[[toc]]

## Embed

https://www.youtube.com/watch?v=dQw4w9WgXcQ

## Bookmark

bookmark: https://github.com

## Columns

\`\`\`columns
Left column content
---
Right column content
\`\`\`

## Image

![remote](https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/120px-Camponotus_flavomarginatus_ant.jpg)

## Mentions & dates

Linked page [[Feature Demo]]. Due @date(2026-06-15) with a reminder @date(2026-06-20|remind).

## Suggested edits (CriticMarkup)

This was {--removed text--} and this was {++inserted text++}. Substitute {~~old~>new~~} inline. {==Highlighted claim==} {>>Reviewer: please verify<<}

## Database — formula column

\`\`\`database
{"columns":[{"id":"c1","name":"Item","type":"text"},{"id":"c2","name":"Qty","type":"number"},{"id":"c3","name":"Price","type":"number"},{"id":"c4","name":"Total","type":"formula","formula":"prop(\\"Qty\\") * prop(\\"Price\\")"}],"rows":[{"id":"r1","c1":"Apples","c2":3,"c3":2},{"id":"r2","c1":"Pears","c2":5,"c3":4},{"id":"r3","c1":"Plums","c2":2,"c3":6}],"views":[{"id":"v1","name":"Table","type":"table"}],"activeView":"v1"}
\`\`\`

## Database — chart view

\`\`\`database
{"columns":[{"id":"c1","name":"Item","type":"text"},{"id":"c2","name":"Qty","type":"number"}],"rows":[{"id":"r1","c1":"Apples","c2":3},{"id":"r2","c1":"Pears","c2":5},{"id":"r3","c1":"Plums","c2":2}],"views":[{"id":"v1","name":"Table","type":"table"},{"id":"v2","name":"Chart","type":"chart","chartType":"bar","groupBy":"c1","agg":"sum","valueColId":"c2"}],"activeView":"v2"}
\`\`\`

## Database — timeline view

\`\`\`database
{"columns":[{"id":"t1","name":"Task","type":"text"},{"id":"t2","name":"Start","type":"date"},{"id":"t3","name":"End","type":"date"}],"rows":[{"id":"r1","t1":"Design","t2":"2026-06-01","t3":"2026-06-10"},{"id":"r2","t1":"Build","t2":"2026-06-08","t3":"2026-06-20"},{"id":"r3","t1":"Ship","t2":"2026-06-18","t3":"2026-06-25"}],"views":[{"id":"v1","name":"Timeline","type":"timeline","startColId":"t2","endColId":"t3"}],"activeView":"v1"}
\`\`\`

## Tasks

- [ ] todo item
- [x] done item
`

try {
  const view = createEditor(document.getElementById('editor'), {})
  setText(view, SAMPLE)
  window.__harnessReady = true
  console.log('[harness] editor mounted, doc length', SAMPLE.length)
} catch (err) {
  window.__harnessError = String(err && err.stack || err)
  console.error('[harness] mount failed', err)
  const pre = document.createElement('pre')
  pre.style.color = 'red'
  pre.textContent = window.__harnessError
  document.body.appendChild(pre)
}
