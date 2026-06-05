export class NewTabModal {
    constructor(callbacks) {
        this.callbacks = callbacks // { onOpen: (path) => void, onCreate: () => void }
        this.isOpen = false
        this.render()
    }

    render() {
        const div = document.createElement('div')
        div.className = 'new-tab-modal-overlay'
        div.style.display = 'none'
        
        div.innerHTML = `
            <div class="new-tab-modal">
                <div class="new-tab-header">
                    <i class="fas fa-search"></i>
                    <input type="text" id="new-tab-input" placeholder="Open in new tab..." autocomplete="off">
                </div>
                
                <div class="new-tab-content">
                    <div class="new-tab-section">
                        <div class="new-tab-item" id="action-create-page">
                            <i class="far fa-edit"></i>
                            <span>Create a new page</span>
                            <span class="shortcut">↵</span>
                        </div>
                    </div>
                    
                    <div class="new-tab-section" id="recent-pages-list">
                        <!-- Recent pages injected here -->
                    </div>
                </div>
                
                <div class="new-tab-footer">
                    <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
                    <span><kbd>↵</kbd> to select</span>
                    <span><kbd>Esc</kbd> to close</span>
                </div>
            </div>
        `
        document.body.appendChild(div)
        this.el = div
        
        // Events
        this.el.addEventListener('click', (e) => {
            if (e.target === this.el) this.close()
        })
        
        const input = this.el.querySelector('#new-tab-input')
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close()
            if (e.key === 'Enter') {
                // If input empty -> Create New
                if (input.value.trim() === '') {
                    this.callbacks.onCreate()
                    this.close()
                } else {
                    // Search logic or select first item
                    // For MVP, just create if typing
                    // Or filter list and select top
                }
            }
        })
        
        this.el.querySelector('#action-create-page').addEventListener('click', () => {
            this.callbacks.onCreate()
            this.close()
        })
    }

    async open() {
        this.isOpen = true
        this.el.style.display = 'flex'
        const input = this.el.querySelector('#new-tab-input')
        input.value = ''
        input.focus()
        
        this.renderRecents()
    }

    close() {
        this.isOpen = false
        this.el.style.display = 'none'
    }
    
    async renderRecents() {
        const container = this.el.querySelector('#recent-pages-list')
        container.innerHTML = '<div class="new-tab-label">Recent Pages</div>'
        
        const recents = await window.api.getSettings('recentFiles') || []
        
        if (recents.length === 0) {
            container.innerHTML += '<div class="new-tab-empty">No recent pages</div>'
            return
        }
        
        for (const path of recents) {
            const name = await window.api.basename(path)
            const div = document.createElement('div')
            div.className = 'new-tab-item'
            div.innerHTML = `
                <i class="far fa-file-alt"></i>
                <span>${name}</span>
            `
            div.addEventListener('click', () => {
                this.callbacks.onOpen(path)
                this.close()
            })
            container.appendChild(div)
        }
    }
}