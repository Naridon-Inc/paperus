# Paperus Markdown Support Contract

This document defines the expected behavior and fidelity for Markdown editing and synchronization in Paperus.

## Core Philosophy
Paperus is a **Markdown-native** editor (CodeMirror 6) that uses the local filesystem as the **Projection**.
- The **editor buffer is Markdown text** — there is no separate rich-text model. Live-preview decorations style the Markdown so it reads like a document.
- The **Internal State (the Yjs CRDT over the Markdown text)** is the source of truth for collaborative history and conflict-free merging.
- The **Markdown File** on disk is the canonical, portable representation, fully interoperable with external tools (VS Code, Obsidian, etc.).

## 1. Round-Trip Safe Features (Guaranteed)
The following features are guaranteed to survive a trip from Paperus → Disk → External Edit → Paperus without data loss or structure corruption:

| Feature | Markdown Syntax | Notes |
| :--- | :--- | :--- |
| **Headings** | `# Heading 1` ... `###### H6` | Always normalized to ATX style. |
| **Bold** | `**text**` | |
| **Italic** | `*text*` | |
| **Strikethrough** | `~~text~~` | GFM standard. |
| **Bullet Lists** | `- Item` | Always normalized to `-` marker. |
| **Numbered Lists** | `1. Item` | |
| **Code Blocks** | ` ```lang\ncode\n``` ` | Fenced blocks only. |
| **Dividers** | `---` | |
| **Task Lists** | `- [ ]` or `- [x]` | GFM standard. |

## 2. Best-Effort Features (Fidelity Varies)
These features will work, but minor formatting changes (like whitespace) may occur during synchronization.

- **Tables**: GFM pipe tables. Deeply nested formatting inside cells may be simplified.
- **Nested Lists**: Supported up to 5 levels. Indentation is preserved, but whitespace may be normalized.
- **Blockquotes**: Supported.

## 3. Custom Extensions (Paperus Specific)
These are CodeMirror 6 block extensions (`cm-*.js`) layered over standard Markdown.
- **Page Links**: Stored as `[Title](doc:ID)` or `[Title](./path.md)`. External tools will see them as standard Markdown links.
- **Callouts / Toggles / Columns**: Represented as Markdown that Paperus decorates as rich blocks; may degrade to plain Markdown (e.g. blockquotes) when viewed in another tool.

## 4. Intentional Degradation & Limitations
- **Raw HTML**: Most raw HTML in Markdown files will be sanitized or stripped upon import to ensure document stability.
- **Metadata**: Document metadata (tags, ownership, specific Yjs GUIDs) is stored in the **Workspace Manifest** (`.notionless/manifest.json`), not inside the `.md` file.

## 5. Conflict Resolution Contract
- **Silent Save**: External changes made while Paperus is closed are merged authoritatively upon opening.
- **Conflict Warning**: If a file is modified externally while Paperus is **actively open** with that document, a conflict dialog will appear.
- **Safety First**: Paperus will never silently overwrite a disk file if the internal editor state appears corrupted or empty.
