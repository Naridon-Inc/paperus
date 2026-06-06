# Markdown Showcase

Everything this editor can render — from basic formatting to advanced blocks.

---

## Text Formatting

This is **bold text**, *italic text*, ***bold italic***, ~~strikethrough~~, and `inline code`.

You can also combine them: **bold with `code` inside**, *italic with ~~strikethrough~~*.

## Headings

### Third Level
#### Fourth Level
##### Fifth Level
###### Sixth Level

---

## Links & Images

Visit [Paperus on GitHub](https://github.com/MHASK/Paperus) for more info.

Auto-linked URL: https://notionless.bucksaas.com

Reference-style link: [Paperus][1]

[1]: https://github.com/MHASK/Paperus

---

## Lists

### Unordered

- First item
- Second item with **bold** and `code`
  - Nested item
  - Another nested item
    - Deep nested
- Back to top level

### Ordered

1. Step one
2. Step two
3. Step three
   1. Sub-step A
   2. Sub-step B

### Task Lists

- [x] Migrate from Quill to CodeMirror 6
- [x] Implement live preview decorations
- [x] Add syntax highlighting
- [ ] Dark mode support
- [ ] Vim keybindings
- [ ] Export to PDF

---

## Blockquotes

> "The best way to predict the future is to invent it."
> — Alan Kay

> **Nested blockquotes** work too:
>
>> This is a nested quote.
>> It can span multiple lines.
>
> Back to the outer quote.

---

## Code Blocks

### JavaScript

```javascript
class DocumentEngine {
  constructor(docId, options = {}) {
    this.docId = docId
    this.ydoc = new Y.Doc()
    this.text = this.ydoc.getText('content')
    this.awareness = new Awareness(this.ydoc)
  }

  async connect() {
    const provider = new WebsocketProvider(WS_URL, this.docId, this.ydoc)
    await provider.whenSynced
    console.log(`Connected to ${this.docId}`)
  }
}
```

### Python

```python
def fibonacci(n: int) -> list[int]:
    """Generate Fibonacci sequence up to n terms."""
    seq = [0, 1]
    for i in range(2, n):
        seq.append(seq[i-1] + seq[i-2])
    return seq[:n]

if __name__ == "__main__":
    print(fibonacci(10))
```

### Shell

```bash
# Deploy to production
docker compose -f docker-compose.prod.yml up -d --build
echo "Deployed at $(date)"

# Check health
curl -s https://api.example.com/health | jq .
```

### CSS

```css
.cm-editor {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.75;
  color: #37352f;
}

.cm-codeblock {
  background: #f6f8fa;
  border-radius: 8px;
  font-family: "SF Mono", Monaco, monospace;
}
```

### JSON

```json
{
  "name": "notionless",
  "version": "1.0.6",
  "description": "A note-taking app with real-time collaboration",
  "features": ["markdown", "crdt-sync", "e2ee", "offline"],
  "electron": true
}
```

### SQL

```sql
SELECT u.name, COUNT(d.id) AS doc_count
FROM users u
LEFT JOIN documents d ON d.owner_id = u.id
WHERE u.created_at > '2025-01-01'
GROUP BY u.name
ORDER BY doc_count DESC
LIMIT 10;
```

### Plain text (no language)

```
This is a plain code block with no syntax highlighting.
It preserves whitespace and uses monospace font.
```

---

## Tables

### Simple Table

| Feature | Status | Notes |
|---------|--------|-------|
| Markdown editing | Done | CodeMirror 6 |
| Live preview | Done | Custom decorations |
| Real-time sync | Done | Yjs CRDTs |
| Dark mode | Planned | Q2 2026 |
| Vim mode | Planned | Community request |

### Comparison Table

| | Quill (Old) | CodeMirror 6 (New) |
|---|---|---|
| **Format** | Rich Text Delta | Raw Markdown |
| **Storage** | Lossy conversion | Direct `.md` write |
| **Collaboration** | `y-quill` | `y-codemirror.next` |
| **Cursors** | Manual DOM | Native yCollab |
| **Performance** | Slow on large docs | Virtualized viewport |
| **Bundle size** | ~180 KB | ~120 KB |

---

## Horizontal Rules

Three styles — all render the same:

---

***

___

---

## Collapsible Sections

<details>
<summary>Click to expand: Architecture Overview</summary>

The app uses a multi-layer sync architecture:

1. **WebSocket** — Server-mediated sync via `y-websocket`
2. **WebRTC** — Peer-to-peer via signaling server
3. **IndexedDB** — Local persistence for offline support

Each document gets its own `Y.Doc` instance managed by `DocumentEngine`.

```javascript
const engine = new DocumentEngine(docId)
await engine.connect()
engine.text.insert(0, 'Hello, world!')
```

</details>

<details>
<summary>Click to expand: Security Model</summary>

### End-to-End Encryption

- Documents are encrypted client-side using **libsodium**
- Master Vault Key (MVK) is derived from user passphrase
- Per-document keys are wrapped with MVK
- Server never sees plaintext content

### Authentication

- **WebAuthn passkeys** for passwordless login
- JWT tokens with short expiry
- Biometric unlock on supported devices

</details>

<details>
<summary>Click to expand: API Endpoints</summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/documents` | List user documents |
| `POST` | `/api/documents` | Create document |
| `PUT` | `/api/documents/:id` | Update document |
| `DELETE` | `/api/documents/:id` | Delete document |
| `POST` | `/api/teams/:id/invite` | Invite to team |

</details>

---

## Callout Blocks

> **Note:** This is an informational callout. Use it for helpful tips and context.

> **Warning:** Be careful when force-pushing to shared branches. This can overwrite other people's work.

> **Tip:** Press `Cmd+S` to save, `Cmd+Shift+P` to open the command palette.

> **Important:** Always back up your vault key. If lost, encrypted documents cannot be recovered.

---

## Inline Elements

### Keyboard Shortcuts

Press `Cmd+B` for bold, `Cmd+I` for italic, `Cmd+K` for links.

### Math & Symbols

E = mc², π ≈ 3.14159, ∑(i=1..n) = n(n+1)/2

Temperature: 23°C → 73.4°F

Arrows: → ← ↑ ↓ ⇒ ⇐

Currency: $99.99 · €89.99 · £79.99

---

## Nested Complex Content

### A list with code and quotes inside

1. First, install dependencies:

   ```bash
   pnpm install
   ```

2. Then configure the environment:

   > Make sure PostgreSQL is running before starting the backend.

3. Start the dev server:

   ```bash
   pnpm run dev:m
   ```

   This starts both the **Electron app** and the **backend server**.

4. Open the app and verify:
   - [ ] Editor loads
   - [ ] Sidebar shows file tree
   - [ ] Real-time sync works
   - [x] Markdown renders correctly

---

## Escaping & Edge Cases

Literal asterisks: \*not bold\*

Literal backticks: \`not code\`

HTML entities: &amp; &lt; &gt; &quot;

Long line that should wrap properly in the editor without horizontal scrolling because line wrapping is enabled and the content area has a max-width of 900px which keeps things readable.

---

*This document demonstrates all supported markdown features in Paperus.*
