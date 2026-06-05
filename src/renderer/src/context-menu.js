export class ContextMenu {
  constructor() {
    this.menu = this.createMenu()
    this.targetPath = null
    this.targetType = null
    this.attachGlobalEvents()
  }

  createMenu() {
    const div = document.createElement('div')
    div.className = 'context-menu'
    div.style.display = 'none'
    document.body.appendChild(div)
    return div
  }

  attachGlobalEvents() {
    document.addEventListener('click', () => this.hide())
    document.addEventListener('contextmenu', (e) => {
       if (!this.menu.contains(e.target)) this.hide()
    })
  }

  show(e, path, type, extraData = {}) {
    e.preventDefault()
    e.stopPropagation()
    this.targetPath = path
    this.targetType = type
    this.extraData = extraData
    
    this.renderItems()
    
    // Position
    this.menu.style.display = 'block'
    this.menu.style.top = `${e.clientY}px`
    this.menu.style.left = `${e.clientX}px`
  }

  hide() {
    this.menu.style.display = 'none'
    this.targetPath = null
  }

  renderItems() {
    this.menu.innerHTML = ''
    
    const items = []
    
    if (this.targetType === 'directory') {
        items.push({ label: 'New Note Here', icon: 'fa-plus', action: 'new-note' })
        if (this.extraData && this.extraData.isRoot) {
            items.push({ label: 'Remove from Sidebar', icon: 'fa-minus-circle', action: 'remove-project' })
        }
        items.push({ type: 'separator' })
    }
    
    if (this.targetType === 'editor-table') {
        items.push({ label: 'Insert Row Above', icon: 'fa-arrow-up', action: 'table-insert-row-above' })
        items.push({ label: 'Insert Row Below', icon: 'fa-arrow-down', action: 'table-insert-row-below' })
        items.push({ label: 'Insert Column Left', icon: 'fa-arrow-left', action: 'table-insert-col-left' })
        items.push({ label: 'Insert Column Right', icon: 'fa-arrow-right', action: 'table-insert-col-right' })
        items.push({ type: 'separator' })
        items.push({ label: 'Delete Row', icon: 'fa-trash', action: 'table-delete-row', danger: true })
        items.push({ label: 'Delete Column', icon: 'fa-trash', action: 'table-delete-col', danger: true })
        items.push({ label: 'Delete Table', icon: 'fa-table', action: 'table-delete', danger: true })
    }
    
    if (this.targetType === 'file' || this.targetType === 'directory') {
        items.push({ label: 'Rename', icon: 'fa-edit', action: 'rename' })
        if (this.targetType === 'file') {
            items.push({ label: 'Reset Formatting', icon: 'fa-magic', action: 'reset-formatting' })
        }
        items.push({ label: 'Delete', icon: 'fa-trash', action: 'delete', danger: true })
        items.push({ type: 'separator' })
        if (this.targetType === 'file') {
            items.push({ label: 'Add to teamspace', icon: 'fa-users', action: 'add-to-teamspace' })
        }
        items.push({ label: 'Add Tag', icon: 'fa-tag', action: 'tag' })
        items.push({ label: 'Reveal in Finder', icon: 'fa-folder', action: 'reveal' })
    }

    items.forEach(item => {
        if (item.type === 'separator') {
            const hr = document.createElement('hr')
            this.menu.appendChild(hr)
            return
        }
        
        const div = document.createElement('div')
        div.className = 'context-menu-item'
        if (item.danger) div.classList.add('danger')
        
        div.innerHTML = `<i class="fas ${item.icon}"></i> ${item.label}`
        
        // Prevent focus loss on click
        div.addEventListener('mousedown', (e) => {
            e.preventDefault()
        })
        
        div.addEventListener('click', () => {
            // Capture path before hiding menu
            this.handleAction(item.action, this.targetPath)
            this.hide()
        })
        this.menu.appendChild(div)
    })
  }

  async handleAction(action, path) {
      if (action.startsWith('table-')) {
          this.handleTableAction(action)
          return
      }
      
      if (!path) return
      
      switch (action) {
          case 'remove-project':
              if (confirm(`Remove folder from sidebar? (Files will NOT be deleted from disk)`)) {
                  const known = await window.api.getSettings('knownProjects') || []
                  const filtered = known.filter(p => p !== path)
                  await window.api.setSettings('knownProjects', filtered)
                  
                  const lastProject = await window.api.getSettings('lastProject')
                  if (lastProject === path) {
                      await window.api.setSettings('lastProject', filtered[0] || null)
                  }
                  
                  window.dispatchEvent(new Event('ctx:refresh'))
              }
              break
          case 'new-note':
              window.dispatchEvent(new CustomEvent('ctx:new-note', { detail: path }))
              break
          case 'reset-formatting':
              if (confirm(`Force reset document to Markdown? This can fix "spoiled" formatting by re-parsing the document.`)) {
                  // We need to trigger this on the active document if possible
                  window.dispatchEvent(new CustomEvent('cmd:reset-formatting', { detail: path }))
              }
              break
          case 'rename':
              const newName = await this.showInputModal('Rename', 'New name', await window.api.basename(path))
              if (newName) {
                 const dir = await window.api.invoke('path:dirname', path)
                 const newPath = `${dir}/${newName}`
                 try {
                     await window.api.invoke('fs:rename', path, newPath)
                     window.dispatchEvent(new Event('ctx:refresh'))
                 } catch (e) {
                     alert('Rename failed: ' + e.message)
                 }
              }
              break
          case 'delete':
              // Soft-delete: route through the global trash handler (moves into
              // .trash/ with an undoable entry). It shows its own confirm and
              // reloads the project tree, falling back to fs:delete on failure.
              window.dispatchEvent(new CustomEvent('cmd:trash-file', { detail: { path } }))
              break
          case 'add-to-teamspace':
              window.dispatchEvent(new CustomEvent('cmd:add-to-teamspace', { detail: { path } }))
              break
          case 'reveal':
               try {
                   await window.api.invoke('fs:reveal', path)
               } catch (e) {
                   alert('Failed to reveal file: ' + e.message)
               }
               break
          case 'tag':
               const tag = await this.showInputModal('Add Tag', 'Tag name')
               if (tag) {
                   try {
                       const success = await window.api.invoke('fs:addTag', { path: path, tag })
                       if (success) {
                           window.dispatchEvent(new Event('ctx:refresh'))
                       } else {
                           alert('Failed to add tag (file might not be in a project)')
                       }
                   } catch (e) {
                       alert('Error adding tag: ' + e.message)
                   }
               }
               break
      }
  }

  showInputModal(title, placeholder, defaultValue = '') {
      return new Promise(resolve => {
        const div = document.createElement('div')
        div.className = 'input-modal'
        div.innerHTML = `
          <div class="input-box">
            <h3>${title}</h3>
            <input type="text" id="modal-input" placeholder="${placeholder}" value="${defaultValue}" autofocus>
            <div class="input-actions">
              <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
              <button class="btn" id="modal-confirm">Confirm</button>
            </div>
          </div>
        `
        document.body.appendChild(div)
        
        const input = div.querySelector('input')
        const confirm = div.querySelector('#modal-confirm')
        const cancel = div.querySelector('#modal-cancel')
        
        // Focus with slight delay to ensure render
        setTimeout(() => input.focus(), 50)
        
        const cleanup = () => div.remove()
        
        confirm.onclick = () => {
          const val = input.value.trim()
          if (val) {
            cleanup()
            resolve(val)
          }
        }
        
        cancel.onclick = () => {
          cleanup()
          resolve(null)
        }
        
        input.onkeydown = (e) => {
          if (e.key === 'Enter') confirm.click()
          if (e.key === 'Escape') cancel.click()
        }
      })
  }
  
  handleTableAction(action) {
      // Tables are rendered as markdown text in CodeMirror — no rich table module.
      // Table editing is done directly in markdown source.
      console.log('[ContextMenu] Table action not available in markdown mode:', action)
  }

}
