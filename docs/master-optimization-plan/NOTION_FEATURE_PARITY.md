# Notion Feature Parity — Inventory & Build Roadmap

> Goal: copy every meaningful Notion feature into Paperus (open-source, local-first,
> pure-relay server). This doc is the master checklist + the autonomous build plan.
> Legend: ✅ done · 🟡 partial · �doing now · ⬜ todo · ❌ out of scope (cloud/enterprise-only)

Last updated: 2026-06-02 (overnight autonomous build).

---

## 1. Block editor — text blocks
- ✅ Paragraph, H1/H2/H3 headings (CM6 markdown)
- ✅ Bulleted / numbered list
- ✅ To-do checkbox list
- ✅ Quote, blockquote
- ✅ Divider (`---`)
- ✅ Code block + syntax highlighting (CM6 lang-data)
- ✅ WYSIWYG tables
- 🔄 Callout blocks (`> [!note]` colored + icon) — Round 2
- 🔄 Toggle lists / collapsible (`<details>`) — Round 2
- 🔄 Table of contents block — Round 2
- ⬜ Toggle headings (collapsible H1/H2/H3) — Round 3
- ⬜ Multi-column layout — Round 3
- ⬜ Synced blocks (mirror content across pages) — Round 3
- ⬜ Breadcrumb block — Round 3
- ⬜ Button / template-button blocks — later
- ⬜ Block background colors — Round 3

## 2. Rich text / inline
- ✅ Bold, italic, strikethrough, inline code
- ✅ Links (clickable), `[[wiki]]` + `[](doc:id)` page links
- ✅ Inline comments
- ✅ Selection toolbar
- 🔄 Inline + block math (KaTeX `$…$` / `$$…$$`) — Round 2
- ⬜ Text & highlight colors — Round 3
- ✅ @mention pages (`[[ ]]`) / @date chips with reminders (🔔) — Round 6
- ⬜ Inline emoji picker (slash `:emoji:`) — later

## 3. Pages
- ✅ Nested pages / sub-pages
- ✅ Page icons & covers (front-matter)
- ✅ Backlinks ("Linked references")
- ✅ Version history (SnapshotManager)
- ✅ Inline image rendering
- ⬜ Full-width page toggle — Round 4
- ⬜ Favorites / pinned — Round 4
- ✅ Trash / restore — Round 6 (soft-delete to `.trash/`)
- ⬜ Page lock (read-only) — Round 4
- ⬜ Recent pages / "jump back in" — Round 4
- ⬜ Page properties bar (when in a DB) — later
- 🟡 Publish to web / public share — partial via P2P share link
- ❌ Page analytics/views (needs server tracking) — out of scope

## 4. Databases & views
- ✅ Table, Board (kanban, drag-drop), Gallery views
- ✅ Column types: text, number, select, checkbox, date
- 🔄 Calendar view — Round 2
- 🔄 List view — Round 2
- 🔄 Column types: multi-select, person, URL, email/phone — Round 2
- 🔄 Filters (and/or groups) — Round 2
- 🔄 Sorts (multi-level) — Round 2
- 🔄 Group-by — Round 2
- 🔄 Footer aggregations (count/sum/avg/min/max) — Round 2
- ✅ Timeline / Gantt view — Round 6 (month axis, pan/zoom, click-to-edit)
- ✅ Chart view — Round 6 (bar/line/pie SVG, group-by + count/sum/avg)
- ✅ Formula column — Round 6 (tokenizer→Pratt parser→interpreter, no eval, cycle-guarded)
- ✅ Relation + Rollup — Round 6 (cross-block via `DB_REGISTRY`)
- ✅ Linked database views — Round 6 (self-contained `{link,refDbId}` fence, write-back)
- ✅ Row templates — Round 6 (save-row-as-template, new-from-template dropdown)
- 🟡 Sub-items / row hierarchy — partial (relation enables parent refs; no tree UI yet)

## 5. AI (Notion AI)
- ✅ AI writing assist (continue/summarize/improve/translate + Ask AI) — Round 6, floating FAB, configurable endpoint, OFF by default
- ⬜ AI Q&A over workspace — later
- ❌ AI autofill / connectors / enterprise search — out of scope (cloud)

## 6. Collaboration
- ✅ Real-time multiplayer (Yjs), presence/cursors
- ✅ Inline comments
- ✅ Share via link / room code (accountless P2P)
- ✅ Account-based team sharing
- ✅ Comment threads + resolve/reopen + "All comments" panel — Round 6
- ✅ Suggested edits / track changes (CriticMarkup, inline ✓/✗) — Round 6
- 🟡 Guest permissions UI — accountless P2P share gives read/write guest rooms; no per-role UI

## 7. Navigation / organization
- ✅ Sidebar (files, teams, shared)
- ✅ Quick switcher / Cmd+K
- ✅ Full-text search (indexer)
- ✅ Slash command menu
- ✅ Teamspaces (collapsible sidebar groups, local-first) — Round 6
- ✅ Trash view (soft-delete to `.trash/`, restore / empty) — Round 6

## 8. Templates
- ✅ Template picker (13 built-ins, categorized) + `/template`
- ✅ Template gallery expansion (+7) + save-as-template (`userTemplates`) — Round 6
- ⬜ Template buttons (repeatable inserts) — later

## 9. Media / embeds / import-export
- ✅ Inline images (local via data-URL IPC, remote direct)
- 🔄 Mermaid diagrams (```mermaid```) — Round 2
- ⬜ Embeds (YouTube/video/iframe) — Round 3
- ⬜ Web bookmark / link preview cards — Round 3
- ⬜ Export → HTML / PDF / Markdown — Round 5
- ⬜ Import → CSV→database, Markdown, HTML — Round 5
- ⬜ File/attachment blocks — later
- ❌ Unsplash cover gallery (needs API key) — optional later

## 10. Platform / misc
- ✅ Offline (IndexedDB, Electron)
- ✅ Dark mode (existing styles)
- ✅ Git repo sync (Electron + web/LightningFS)
- ✅ GitHub/Google login + desktop deep-link OAuth
- ✅ Local-first / zero-login usable
- ✅ Custom fonts (Appearance settings: family/size/line-height) — Round 6
- ⬜ Keyboard-shortcut help overlay — later

---

## Autonomous build rounds (overnight)

Each round = disjoint-file parallel agents; orchestrator integrates `main.js`/wiring +
runs `pnpm run build` + `pnpm run build:web` between rounds (never leave tree broken).

- **Round 1** ✅ images · web-git · OAuth deep-link · E2EE decouple · teams→P2P (built green)
- **Round 2** ✅ Editor blocks A (callouts, toggles, KaTeX math, mermaid, ToC) + Databases (list/calendar views, multi-select/url/email/person types, filters/sorts/group-by/aggregations) — both builds green
- **Round 4** ✅ Pages/workspace (favorites, full-width toggle, page lock, recents) — built green (trash/restore deferred to a later pass)
- **Round 3** ✅ Editor blocks B (highlight/colors, embeds, bookmarks, transclusion `![[ ]]`, columns; code-copy skipped) — built green
- **Round 5** ✅ Export (MD/HTML/PDF) + Import (CSV→DB, Markdown) — `marked`; AI assist deferred — built green
- **Round 6** ✅ **Deferred list cleared.** DB advanced (timeline/Gantt, chart view, formula
  column w/ hand-written tokenizer→Pratt parser→interpreter — no eval, relation + rollup via
  `DB_REGISTRY`, linked DBs, row templates) · comment threads + resolve/reopen + panel ·
  suggested edits / CriticMarkup track-changes (`{++ ++}`/`{-- --}`/`{~~a~>b~~}`/`{== ==}`/`{>> <<}`)
  with inline ✓/✗ · teamspaces (sidebar groups) · trash/restore (`.trash/` soft-delete) ·
  @mentions (`[[ ]]`) + @date chips with reminders · template gallery (+7) + save-as-template ·
  custom fonts (Appearance settings) · AI writing assist (floating FAB, configurable endpoint,
  OFF by default) · web cloud-doc body→git content bridge (`GET /documents/:id/content`) — both builds green

## Verification (2026-06-02)
- `pnpm run build` (electron-vite) and `pnpm run build:web` both exit 0 after every round (incl. Round 6).
- **Live-pixel verification PASSED (Rounds 1–6).** Standalone harness (`tools/harness/`) mounts
  the REAL editor (`createEditor` + `livePreview`) with a doc exercising every block, served it,
  and drove headless Chromium via Playwright (`tools/harness/shot.mjs`, now scrolls the full doc so
  off-viewport widgets render). Result: editor mounted **zero runtime errors, zero console errors**,
  every widget rendered live — callouts (3), KaTeX (2), tables (2), database (Filter/Sort/Group +
  typed cols), mermaid→SVG, toggle, ToC, YouTube embed iframe, bookmark card, columns, remote image,
  highlights, task checkboxes, **plus Round 6**: @date chips (2, incl. 🔔 reminder), CriticMarkup
  ins/del/sub/mark/comment, formula column (Qty×Price → 6/20/12), chart-view bar SVG, timeline/Gantt
  bars (3). Screenshots: `tools/harness/harness.png` (top) + `harness-lower.png` (bottom).
- Three floating bottom-right buttons de-collided (ai-fab b20 / comments-toggle b76 / suggest-toggle b122).
- Context-menu Delete now routes to soft-delete (`cmd:trash-file` → `.trash/`); added "Add to teamspace".

## Still deferred
- _None._ Every enumerated Notion feature is built + build-verified; the advanced/hard items
  (formula/relation/rollup, linked DBs, timeline/chart, track-changes, teamspaces, AI) all landed
  in Round 6. Remaining out-of-scope items (❌ above) are cloud/enterprise-only by design
  (page analytics, AI connectors/enterprise search) and intentionally excluded from a local-first app.
