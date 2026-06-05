import Quill from 'quill'

export class BlockHandle {
  constructor(quill) {
    this.quill = quill
    this.handle = this.createHandle()
    this.menu = this.createMenu()
    this.currentBlock = null
    this.attachEvents()
  }

  createHandle() {
    const div = document.createElement('div')
    div.className = 'block-handle'
    div.innerHTML = `<i class="fas fa-plus"></i> <i class="fas fa-grip-vertical"></i>`
    div.style.display = 'none'
    document.body.appendChild(div) // Append to body to avoid clipping
    return div
  }

  createMenu() {
    const div = document.createElement('div')
    div.className = 'block-menu'
    div.style.display = 'none'
    
    const options = [
      { label: 'Text', format: 'paragraph', icon: '¶' },
      { label: 'Heading 1', format: 'header', value: 1, icon: 'H1' },
      { label: 'Heading 2', format: 'header', value: 2, icon: 'H2' },
      { label: 'Heading 3', format: 'header', value: 3, icon: 'H3' },
      { label: 'Bullet List', format: 'list', value: 'bullet', icon: '•' },
      { label: 'Numbered List', format: 'list', value: 'ordered', icon: '1.' },
      { label: 'Check List', format: 'list', value: 'checked', icon: '<i class="far fa-check-square"></i>' },
      { label: 'Blockquote', format: 'blockquote', value: true, icon: '“' },
      { label: 'Code Block', format: 'code-block', value: true, icon: '</>' }
    ]

    options.forEach(opt => {
      const item = document.createElement('div')
      item.className = 'block-menu-item'
      item.innerHTML = `<span class="icon">${opt.icon}</span> ${opt.label}`
      item.addEventListener('click', () => {
        this.applyFormat(opt)
      })
      div.appendChild(item)
    })

    document.body.appendChild(div)
    return div
  }

  attachEvents() {
    const editor = this.quill.root
    
    // Mouse Move - Show Handle
    editor.addEventListener('mousemove', (e) => {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (!range) return
      
      let node = range.startContainer
      if (node.nodeType === 3) node = node.parentNode // Text node -> Element
      
      // Find block parent (p, h1, etc.) directly inside editor
      while (node && node.parentNode !== editor) {
        node = node.parentNode
      }
      
      if (node && node !== this.currentBlock) {
        this.showHandle(node)
      }
    })
    
    // Hide when leaving editor (scrolling logic might need improvement)
    this.quill.container.addEventListener('mouseleave', () => {
       // Check if hovering handle
    })
    
    // Handle Click
    this.handle.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleMenu()
    })
    
    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!this.menu.contains(e.target) && e.target !== this.handle) {
        this.menu.style.display = 'none'
      }
    })
  }

  showHandle(block) {
    this.currentBlock = block
    const rect = block.getBoundingClientRect()
    
    this.handle.style.display = 'flex'
    // Align vertically with the block
    this.handle.style.top = `${rect.top + window.scrollY}px`
    
    // Position to the left of the text content
    // We want it in the gutter. 
    // Handle width is ~24px. Let's put it 32px to the left of content.
    this.handle.style.left = `${rect.left - 32}px`
  }

  toggleMenu() {
    if (this.menu.style.display === 'block') {
      this.menu.style.display = 'none'
    } else {
      const rect = this.handle.getBoundingClientRect()
      this.menu.style.display = 'block'
      this.menu.style.top = `${rect.bottom + 5}px`
      this.menu.style.left = `${rect.left}px`
    }
  }

  applyFormat(opt) {
    if (!this.currentBlock) return
    
    const blot = Quill.find(this.currentBlock)
    if (blot) {
      const index = this.quill.getIndex(blot)
      const length = blot.length()
      
      // Reset format first to clear existing block formats (like lists)
      this.quill.formatLine(index, length, 'list', false)
      this.quill.formatLine(index, length, 'header', false)
      this.quill.formatLine(index, length, 'blockquote', false)
      this.quill.formatLine(index, length, 'code-block', false)
      
      if (opt.format === 'paragraph') {
         // Already reset
      } else {
         this.quill.formatLine(index, 1, opt.format, opt.value)
      }
    }
    
    this.menu.style.display = 'none'
  }
}
