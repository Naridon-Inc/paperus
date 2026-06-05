import { Indexer } from './indexer'

export class CommandPalette {
  constructor(indexer) {
    this.indexer = indexer
    this.isOpen = false
    this.overlay = this.createOverlay()
    this.attachEvents()
  }

  createOverlay() {
    const div = document.createElement('div')
    div.className = 'cmd-palette-overlay'
    div.style.display = 'none'
    
    div.innerHTML = `
      <div class="cmd-palette-modal">
        <div class="cmd-palette-search">
          <i class="fas fa-search"></i>
          <input type="text" id="cmd-input" placeholder="Search files, content, or commands..." autocomplete="off">
        </div>
        <div class="cmd-palette-results" id="cmd-results">
            <!-- Results injected here -->
        </div>
        <div class="cmd-palette-footer">
            <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
            <span><kbd>↵</kbd> to select</span>
            <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    `
    document.body.appendChild(div)
    return div
  }

  attachEvents() {
    // Toggle on Cmd+K or Ctrl+K
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        this.toggle()
      }
      if (e.key === 'Escape' && this.isOpen) {
        this.close()
      }
    })
    
    // Close on click outside
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close()
    })
    
    const input = this.overlay.querySelector('#cmd-input')
    input.addEventListener('input', (e) => this.handleSearch(e.target.value))
    
    // Navigation logic (simple)
    input.addEventListener('keydown', (e) => {
        // Implement arrow navigation later if needed
    })
  }

  toggle() {
    if (this.isOpen) this.close()
    else this.open()
  }

  open() {
    this.isOpen = true
    this.overlay.style.display = 'flex'
    const input = this.overlay.querySelector('#cmd-input')
    input.value = ''
    input.focus()
    this.handleSearch('') // Show default/recent?
  }

  close() {
    this.isOpen = false
    this.overlay.style.display = 'none'
  }

  handleSearch(query) {
    const resultsContainer = this.overlay.querySelector('#cmd-results')
    
    if (!query) {
        resultsContainer.innerHTML = '<div class="cmd-empty">Type to search...</div>'
        return
    }
    
    // Search using Indexer
    if (this.indexer) {
        const hits = this.indexer.search(query)
        if (hits.length === 0) {
            resultsContainer.innerHTML = '<div class="cmd-empty">No results found.</div>'
            return
        }
        
        resultsContainer.innerHTML = hits.slice(0, 10).map(hit => `
            <div class="cmd-item" data-path="${hit.path}">
                <div class="cmd-item-icon"><i class="far fa-file-alt"></i></div>
                <div class="cmd-item-content">
                    <div class="cmd-item-title">${hit.title}</div>
                    <div class="cmd-item-subtitle">${hit.content.substring(0, 80)}...</div>
                </div>
            </div>
        `).join('')
        
        // Add click listeners
        resultsContainer.querySelectorAll('.cmd-item').forEach(item => {
            item.addEventListener('click', () => {
                // We need a way to open file. 
                // Best way: Dispatch a global event that main.js listens to.
                window.dispatchEvent(new CustomEvent('cmd:open-file', { detail: item.dataset.path }))
                this.close()
            })
        })
    }
  }
}
