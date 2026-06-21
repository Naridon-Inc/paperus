export class TabManager {
  constructor(openFileCallback) {
    this.openFile = openFileCallback
    this.tabs = []
    this.activeTabIndex = -1
    this.tabList = document.getElementById('tab-list')
    this.newTabModal = null
  }

  init(NewTabModalClass, createNewNoteCallback) {
    this.NewTabModalClass = NewTabModalClass
    this.createNewNote = createNewNoteCallback
    
    document.getElementById('add-tab-btn').addEventListener('click', () => {
        if (!this.newTabModal) {
            this.newTabModal = new this.NewTabModalClass({
                onCreate: async () => {
                    // Create new tab first
                    this.addTab(null, 'New Note')
                    await this.createNewNote()
                },
                onOpen: async (path) => {
                    const name = await window.api.basename(path)
                    this.addTab(path, name)
                }
            })
        }
        this.newTabModal.open()
    })
  }

  renderTabs() {
    if (!this.tabList) {
        this.tabList = document.getElementById('tab-list')
    }
    if (!this.tabList) return
    
    this.tabList.innerHTML = ''
    console.log('[TabManager] Rendering tabs:', this.tabs.length)
    this.tabs.forEach((tab, index) => {
        const div = document.createElement('div')
        div.className = `tab ${index === this.activeTabIndex ? 'active' : ''}`
        const displayName = (tab.title || 'Untitled').replace(/_/g, ' ')
        div.innerHTML = `
            <span class="tab-title">${displayName}</span>
            <span class="tab-close"><i class="fas fa-times"></i></span>
        `
        div.addEventListener('click', () => this.switchTab(index))
        div.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation()
            this.closeTab(index)
        })
        this.tabList.appendChild(div)
    })
  }

  async switchTab(index) {
    if (index === this.activeTabIndex) return
    
    const prevTab = this.tabs[this.activeTabIndex]
    const tab = this.tabs[index]
    
    this.activeTabIndex = index
    this.renderTabs()
    
    if (tab && (!prevTab || prevTab.path !== tab.path)) {
        await this.openFile(tab.path, tab.title)
    } else if (!tab) {
        if (this.onEmptyState) this.onEmptyState()
    }
  }

  async closeTab(index) {
    const closedTab = this.tabs[index]
    this.tabs.splice(index, 1)
    if (this.onTabClose && closedTab) { try { this.onTabClose(closedTab.path) } catch (_e) { /* noop */ } }
    
    if (this.activeTabIndex > index) {
        this.activeTabIndex--
    } else if (this.activeTabIndex === index) {
        this.activeTabIndex = Math.min(this.tabs.length - 1, index)
    }

    if (this.tabs.length === 0) {
        this.activeTabIndex = -1
        if (this.onEmptyState) this.onEmptyState()
    } else {
        const nextTab = this.tabs[this.activeTabIndex]
        if (nextTab) {
            await this.openFile(nextTab.path, nextTab.title)
        }
    }
    this.renderTabs()
  }

  addTab(path, title) {
    // Check if already open
    const existing = this.tabs.findIndex(t => t.path === path)
    if (existing >= 0) {
        this.switchTab(existing)
        return
    }
    
    this.tabs.push({ path, title })
    this.activeTabIndex = this.tabs.length - 1
    this.renderTabs()
    this.openFile(path, title)
  }
  
  updateCurrentTab(path, title) {
      if (this.activeTabIndex >= 0) {
          this.tabs[this.activeTabIndex].path = path
          this.tabs[this.activeTabIndex].title = title
          this.renderTabs()
      } else {
          // If no tab active (e.g. fresh start), add one
          this.addTab(path, title)
      }
  }
}
