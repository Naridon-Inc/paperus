import { ExportModal } from './export-modal'
import { setReadOnly } from './cm-editor'

export class MoreMenu {
    constructor(docEngine) {
        this.docEngine = docEngine
        this.isOpen = false
        this.exportModal = new ExportModal()
        this.render()
        this.attachEvents()
    }

    render() {
        // Add "..." button to header
        const headerRight = document.querySelector('.header-right')
        if (headerRight) {
            const btn = document.createElement('button')
            btn.className = 'icon-btn'
            btn.id = 'more-menu-btn'
            btn.title = 'More options'
            btn.innerHTML = '<i class="fas fa-ellipsis-h"></i>'
            headerRight.appendChild(btn)
            
            btn.onclick = (e) => {
                e.stopPropagation()
                this.toggle()
            }
        }

        // Create Dropdown
        const div = document.createElement('div')
        div.id = 'more-menu-dropdown'
        div.className = 'more-menu-dropdown'
        div.style.display = 'none'
        
        div.innerHTML = `
            <div class="more-menu-section">
                <div class="more-menu-label">Style</div>
                <div class="more-menu-row font-select">
                    <button class="font-btn active" data-font="sans">Ag</button>
                    <button class="font-btn" data-font="serif" style="font-family: serif;">Ag</button>
                    <button class="font-btn" data-font="mono" style="font-family: monospace;">Ag</button>
                </div>
                <div class="more-menu-row toggle-row" id="toggle-small-text">
                    <span>Small text</span>
                    <div class="toggle-switch"></div>
                </div>
                <div class="more-menu-row toggle-row" id="toggle-full-width">
                    <span>Full width</span>
                    <div class="toggle-switch"></div>
                </div>
            </div>
            
            <div class="more-menu-section">
                <div class="more-menu-item" id="action-copy-link">
                    <i class="fas fa-link"></i> Copy link
                </div>
                <div class="more-menu-item" id="action-duplicate">
                    <i class="far fa-copy"></i> Duplicate
                </div>
                <div class="more-menu-item" id="action-move-to">
                    <i class="fas fa-folder-open"></i> Move to
                </div>
                <div class="more-menu-item danger" id="action-trash">
                    <i class="far fa-trash-alt"></i> Move to Trash
                </div>
            </div>
            
            <div class="more-menu-section">
                <div class="more-menu-item" id="tool-history">
                    <i class="fas fa-history"></i> Page History
                </div>
                <div class="more-menu-item" id="tool-props">
                    <i class="fas fa-cog"></i> Properties
                </div>
                <div class="more-menu-item" id="tool-lock">
                    <i class="fas fa-lock"></i> Lock page
                    <div class="toggle-switch small" id="lock-toggle"></div>
                </div>
                <div class="more-menu-item" id="tool-import">
                    <i class="fas fa-file-import"></i> Import
                </div>
                <div class="more-menu-item" id="tool-export">
                    <i class="fas fa-file-export"></i> Export
                </div>
            </div>
            
            <div class="more-menu-section info-section">
                <div class="more-menu-label">Word Count</div>
                <div class="stats-grid">
                    <div><span id="stat-words">0</span> Words</div>
                    <div><span id="stat-chars">0</span> Characters</div>
                    <div style="grid-column: span 2; margin-top: 4px; color: #999;">
                        Reading time: <span id="stat-time">0m</span>
                    </div>
                </div>
            </div>
        `
        
        document.body.appendChild(div)
        
        // Close on click outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !div.contains(e.target) && e.target.id !== 'more-menu-btn' && !e.target.closest('#more-menu-btn')) {
                this.close()
            }
        })
    }

    attachEvents() {
        // Font Selection
        document.querySelectorAll('.font-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                this.setFont(btn.dataset.font)
            }
        })

        // Toggles
        document.getElementById('toggle-small-text').onclick = () => this.toggleSetting('isSmallText')
        document.getElementById('toggle-full-width').onclick = () => this.toggleSetting('isFullWidth')
        
        // Actions
        document.getElementById('action-copy-link').onclick = () => window.dispatchEvent(new CustomEvent('cmd:copy-link'))
        document.getElementById('action-duplicate').onclick = () => window.dispatchEvent(new CustomEvent('cmd:duplicate-file'))
        document.getElementById('action-move-to').onclick = () => window.dispatchEvent(new CustomEvent('cmd:move-file'))
        document.getElementById('action-trash').onclick = () => window.dispatchEvent(new CustomEvent('cmd:trash-file'))
        
        // Tools
        document.getElementById('tool-history').onclick = () => window.dispatchEvent(new CustomEvent('cmd:history'))
        document.getElementById('tool-props').onclick = () => window.dispatchEvent(new CustomEvent('cmd:properties'))
        document.getElementById('tool-lock').onclick = () => this.toggleLock()
        document.getElementById('tool-import').onclick = () => window.dispatchEvent(new CustomEvent('cmd:import-file'))
        document.getElementById('tool-export').onclick = () => this.handleExport()
    }
    
    handleExport() {
        this.exportModal.open()
    }

    toggle() {
        const el = document.getElementById('more-menu-dropdown')
        this.isOpen = !this.isOpen
        el.style.display = this.isOpen ? 'block' : 'none'
        
        if (this.isOpen) {
            const btn = document.getElementById('more-menu-btn')
            const rect = btn.getBoundingClientRect()
            el.style.top = (rect.bottom + 8) + 'px'
            el.style.right = (window.innerWidth - rect.right) + 'px'
            
            this.updateStats()
            this.syncState()
        }
    }

    close() {
        document.getElementById('more-menu-dropdown').style.display = 'none'
        this.isOpen = false
    }
    
    updateStats() {
        const text = (this.docEngine && this.docEngine.text) ? this.docEngine.text.toString().trim() : ''
        const words = text ? text.split(/\s+/).length : 0
        const chars = text.length
        const time = Math.ceil(words / 200) + 'm'

        document.getElementById('stat-words').textContent = words
        document.getElementById('stat-chars').textContent = chars
        document.getElementById('stat-time').textContent = time
    }
    
    async syncState() {
        if (!this.docEngine || !this.docEngine.meta) return
        
        const font = this.docEngine.meta.get('fontStyle') || 'sans'
        const small = this.docEngine.meta.get('isSmallText') || false
        const full = this.docEngine.meta.get('isFullWidth') || false
        const locked = this.docEngine.meta.get('isLocked') || false
        
        // Update UI
        document.querySelectorAll('.font-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.font === font)
        })
        
        const updateToggle = (id, active) => {
            const el = document.getElementById(id).querySelector('.toggle-switch')
            el.classList.toggle('active', active)
        }
        
        updateToggle('toggle-small-text', small)
        updateToggle('toggle-full-width', full)
        
        const lockToggle = document.getElementById('lock-toggle')
        lockToggle.classList.toggle('active', locked)
    }
    
    setFont(font) {
        if (!this.docEngine) return
        this.docEngine.updateMetadata('fontStyle', font)
        this.applyStyles()
    }
    
    toggleSetting(key) {
        if (!this.docEngine) return
        const current = this.docEngine.meta.get(key) || false
        this.docEngine.updateMetadata(key, !current)
        this.applyStyles()
        this.syncState()
    }
    
    async toggleLock() {
         if (!this.docEngine) return
         
         const current = this.docEngine.meta.get('isLocked') || false
         // Local-first: your notes are yours — lock/unlock freely, no roles or
         // server permission check (there's no account in this build).
         this.docEngine.updateMetadata('isLocked', !current)
         this.syncState()
         // Apply lock effect handled in applyStyles or observer
    }
    
    applyStyles() {
        if (!this.docEngine) return
        const font = this.docEngine.meta.get('fontStyle') || 'sans'
        const small = this.docEngine.meta.get('isSmallText') || false
        const full = this.docEngine.meta.get('isFullWidth') || false
        const locked = this.docEngine.meta.get('isLocked') || false

        const editor = document.querySelector('.cm-editor')
        const container = document.querySelector('.editor-container')

        if (editor) {
            editor.classList.remove('font-sans', 'font-serif', 'font-mono', 'text-small')
            editor.classList.add(`font-${font}`)
            if (small) editor.classList.add('text-small')
        }
        if (container) {
            container.classList.remove('full-width')
            if (full) container.classList.add('full-width')
        }

        setReadOnly(window.cmView, locked)

        let lockIcon = document.getElementById('header-lock-icon')
        if (locked) {
            if (!lockIcon) {
                lockIcon = document.createElement('i')
                lockIcon.id = 'header-lock-icon'
                lockIcon.className = 'fas fa-lock'
                lockIcon.style.color = '#999'
                lockIcon.style.marginRight = '8px'
                lockIcon.title = 'Page Locked'
                document.querySelector('.title-bar').appendChild(lockIcon)
            }
        } else {
            if (lockIcon) lockIcon.remove()
        }
    }
}
