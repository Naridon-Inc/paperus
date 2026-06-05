export class PropertiesManager {
  constructor() {
    this.isOpen = false
    this.currentPath = null
    this.render()
    this.attachEvents()
  }

  render() {
    const drawer = document.createElement('div')
    drawer.id = 'properties-drawer'
    drawer.className = 'history-drawer' // Reuse history drawer styling for right-side slide
    drawer.innerHTML = `
      <div class="history-header" style="flex-direction: row; justify-content: flex-start; gap: 12px;">
        <button class="icon-btn" id="properties-close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">&times;</button>
        <span style="font-weight: 600;">File Properties</span>
      </div>
      <div class="properties-content" style="padding: 20px;">
        <div class="prop-group">
            <label>Name</label>
            <div id="prop-name" class="prop-value"></div>
        </div>
        <div class="prop-group">
            <label>Path</label>
            <div id="prop-path" class="prop-value" style="word-break: break-all; font-size: 11px; color: #999;"></div>
        </div>
        <div class="prop-group">
            <label>Size</label>
            <div id="prop-size" class="prop-value"></div>
        </div>
        <div class="prop-group">
            <label>Last Modified</label>
            <div id="prop-mtime" class="prop-value"></div>
        </div>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        
        <div class="prop-group">
            <label>Sharing</label>
            <div id="prop-sharing" class="sharing-status">
                <i class="fas fa-spinner fa-spin"></i> Checking...
            </div>
            <button class="btn" id="prop-share-btn" style="width: 100%; margin-top: 10px;">Share File</button>
        </div>
      </div>
    `
    document.getElementById('app').appendChild(drawer)
  }

  attachEvents() {
    document.getElementById('properties-close-btn').addEventListener('click', () => this.close())
    
    document.getElementById('prop-share-btn').addEventListener('click', () => {
        this.close()
        // Trigger Team Share Modal
        // We need to access TeamManager. Ideally it's a global or we dispatch an event.
        // Let's use an event to decouple.
        window.dispatchEvent(new CustomEvent('cmd:share-file', { detail: this.currentPath }))
    })
  }

  async open(path) {
    if (!path) return
    this.currentPath = path
    
    // Fetch stats
    try {
        const stats = await window.api.invoke('fs:stat', path) // We need to ensure this IPC exists or use node fs via preload?
        // Wait, we don't have fs:stat exposed. We have fs:getDirectoryTree.
        // I should add fs:stat to main process or just assume some data.
        // Actually, let's add fs:stat to main.js if not present.
        
        const name = await window.api.basename(path)
        
        document.getElementById('prop-name').textContent = name
        document.getElementById('prop-path').textContent = path
        document.getElementById('prop-size').textContent = 'Loading...'
        document.getElementById('prop-mtime').textContent = 'Loading...'
        
        // Open Drawer
        document.getElementById('properties-drawer').classList.add('open')
        document.querySelector('.main').classList.add('history-open') // Reusing class for layout shift
        this.isOpen = true
        
        // Populate real stats if available
        // Note: For now we might mock or need to add IPC
        // Let's assume we add fs:stat IPC
        const fileStats = await window.api.invoke('fs:stat', path)
        if (fileStats) {
            document.getElementById('prop-size').textContent = this.formatBytes(fileStats.size)
            document.getElementById('prop-mtime').textContent = new Date(fileStats.mtime).toLocaleString()
        }
        
        this.updateSharingStatus(path)
        
    } catch (e) {
        console.error('Failed to load props', e)
    }
  }

  async updateSharingStatus(path) {
    const el = document.getElementById('prop-sharing')
    if (!el) return
    // Local-first: notes live on your device, private by default. Sharing is
    // peer-to-peer and per-session (via a link) — there's no cloud account or
    // server-side team list to query.
    const engine = (typeof window !== 'undefined' && window.docEngine) ? window.docEngine : null
    const sharedThisSession = !!(engine && engine._shareCode)
    if (sharedThisSession) {
        el.innerHTML = '<i class="fas fa-link" style="color: #00a080;"></i> Shared via link (peer-to-peer)'
        el.style.background = '#e6fffa'
        el.style.color = '#00a080'
    } else {
        el.innerHTML = '<i class="fas fa-lock"></i> Private · on this device'
        el.style.background = '#f5f5f5'
        el.style.color = '#333'
    }
  }

  close() {
    document.getElementById('properties-drawer').classList.remove('open')
    document.querySelector('.main').classList.remove('history-open')
    this.isOpen = false
  }
  
  formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
  }
}
