import * as Y from 'yjs'
import { cryptoManager } from './crypto'
import sodium from 'libsodium-wrappers'
import { diffWords } from 'diff'
import { setReadOnly } from './cm-editor'

export class HistoryManager {
  constructor() {
    this.isOpen = false
    this.currentContent = ''
    this.currentTitle = ''
    this.previewEl = null
    this.previewContentEl = null
    this.render()
    this.attachEvents()
  }

  render() {
    const drawer = document.createElement('div')
    drawer.id = 'history-drawer'
    drawer.className = 'history-drawer'
    drawer.innerHTML = `
      <div class="history-header">
        <span>History</span>
        <button class="icon-btn" id="history-close-btn">&times;</button>
      </div>
      <ul class="history-list" id="history-list"></ul>
      <div class="history-actions" id="history-actions" style="display:none;">
        <button class="btn" id="history-restore-btn">Restore This Version</button>
      </div>
    `
    document.getElementById('app').appendChild(drawer)
  }

  attachEvents() {
    document.getElementById('history-close-btn').addEventListener('click', () => this.close())
    document.getElementById('history-restore-btn').addEventListener('click', () => this.restore())
  }

  async open(path, docId, currentContent) {
    this.currentPath = path
    this.docId = docId
    this.currentContent = currentContent
    this.currentTitle = document.getElementById('doc-title').value

    document.getElementById('history-drawer').classList.add('open')
    document.querySelector('.main').classList.add('history-open')
    this.isOpen = true

    setReadOnly(window.cmView, true)
    document.getElementById('doc-title').disabled = true
    this.ensurePreview()

    await this.loadHistory()
  }

  close() {
    document.getElementById('history-drawer').classList.remove('open')
    document.querySelector('.main').classList.remove('history-open')
    this.isOpen = false
    this.hidePreview()

    if (this.currentContent) {
        document.getElementById('doc-title').value = this.currentTitle
    }
    setReadOnly(window.cmView, false)
    document.getElementById('doc-title').disabled = false
  }

  async loadHistory() {
    const list = document.getElementById('history-list')
    list.innerHTML = '<div style="padding: 20px; color: #999; text-align: center;">Loading...</div>'

    const history = await window.api.invoke('fs:getHistory', this.docId)

    list.innerHTML = ''

    const currentLi = document.createElement('li')
    currentLi.className = 'history-item active'
    currentLi.innerHTML = `
      <div class="label">Current Version</div>
      <div class="time">Now</div>
    `
    currentLi.addEventListener('click', () => {
       this.showDiff(null)
       document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'))
       currentLi.classList.add('active')
       document.getElementById('history-actions').style.display = 'none'
    })
    list.appendChild(currentLi)

    history.forEach((snap) => {
      const li = document.createElement('li')
      li.className = 'history-item'

      const date = new Date(snap.timestamp)
      const label = snap.label || `Autosave`

      li.innerHTML = `
        <div class="label">${label}</div>
        <div class="time">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</div>
      `

      li.addEventListener('click', () => {
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'))
        li.classList.add('active')
        this.selectVersion(snap)
      })

      list.appendChild(li)
    })
  }

  async selectVersion(snapshot) {
    this.selectedSnapshot = snapshot
    document.getElementById('history-actions').style.display = 'flex'

    try {
        const buffer = await window.api.invoke('fs:loadSnapshot', {
            docId: this.docId,
            snapshotId: snapshot.id
        })

        if (!buffer) throw new Error('Snapshot data missing')

        const key = sodium.from_hex(snapshot.key)
        const decrypted = cryptoManager.decryptData(new Uint8Array(buffer), key)

        const tempDoc = new Y.Doc()
        Y.applyUpdate(tempDoc, decrypted)
        const snapshotText = tempDoc.getText('content').toString()

        this.showDiff(snapshotText)

    } catch (e) {
        this.showPreview(`<p style="color:red">Error loading snapshot: ${e.message}</p>`)
    }
  }

  showDiff(oldText) {
    if (oldText === null) {
        document.getElementById('doc-title').value = this.currentTitle
        this.hidePreview()
        return
    }

    let bodyToRender = oldText
    let titleToRender = 'Untitled'

    const match = oldText.match(/^# (.*)(\n|$)/)
    if (match) {
       titleToRender = match[1]
       bodyToRender = oldText.substring(match[0].length).trimStart()
    }

    document.getElementById('doc-title').value = titleToRender

    let currentBody = this.currentContent
    const cm = currentBody.match(/^# (.*)(\n|$)/)
    if (cm) currentBody = currentBody.substring(cm[0].length).trimStart()

    const changes = diffWords(bodyToRender, currentBody)

    const diffHtml = changes.map(part => {
        const escaped = part.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
        if (part.added) {
             return `<span class="diff-added">${escaped}</span>`
        } else if (part.removed) {
             return `<span class="diff-removed">${escaped}</span>`
        }
        return escaped
    }).join('')

    this.showPreview(`<div class="history-preview-content" style="white-space:pre-wrap; font-family:monospace; padding:40px 60px; line-height:1.7;">${diffHtml}</div>`)
  }

  ensurePreview() {
    if (this.previewEl) return
    const container = document.querySelector('.editor-container')
    if (!container) return
    const preview = document.createElement('div')
    preview.id = 'history-preview'
    preview.className = 'history-preview'
    preview.innerHTML = `<div class="history-preview-content"></div>`
    container.appendChild(preview)
    this.previewEl = preview
    this.previewContentEl = preview.querySelector('.history-preview-content')
  }

  showPreview(html) {
    this.ensurePreview()
    if (!this.previewEl || !this.previewContentEl) return
    this.previewContentEl.innerHTML = html
    this.previewEl.style.display = 'block'
    document.getElementById('editor').style.visibility = 'hidden'
  }

  hidePreview() {
    if (!this.previewEl || !this.previewContentEl) return
    this.previewContentEl.innerHTML = ''
    this.previewEl.style.display = 'none'
    document.getElementById('editor').style.visibility = 'visible'
  }

  async restore() {
    if (!this.selectedSnapshot) return

    if (confirm('Restore this version?')) {
        const event = new CustomEvent('restore-version', {
            detail: {
                snapshotId: this.selectedSnapshot.id,
                key: this.selectedSnapshot.key
            }
        })
        window.dispatchEvent(event)
        this.close()
    }
  }
}
