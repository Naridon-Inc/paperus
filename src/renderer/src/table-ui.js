import Quill from 'quill'

export class TableUI {
  constructor(quill) {
    this.quill = quill
    this.createOverlay()
    this.targetCell = null
    this.hideTimeout = null
    
    this.attachEvents()
  }

  createOverlay() {
    this.overlay = document.createElement('div')
    this.overlay.className = 'table-ui-overlay'
    
    // Row Add Button
    this.rowBtn = document.createElement('div')
    this.rowBtn.className = 'table-add-btn row-add'
    this.rowBtn.innerHTML = '<i class="fas fa-plus"></i>'
    this.rowBtn.title = 'Insert Row Below'
    
    // Col Add Button
    this.colBtn = document.createElement('div')
    this.colBtn.className = 'table-add-btn col-add'
    this.colBtn.innerHTML = '<i class="fas fa-plus"></i>'
    this.colBtn.title = 'Insert Column Right'
    
    this.overlay.appendChild(this.rowBtn)
    this.overlay.appendChild(this.colBtn)
    
    this.quill.container.appendChild(this.overlay)
  }

  attachEvents() {
    this.quill.root.addEventListener('mousemove', (e) => {
        const cell = e.target.closest('td, th')
        if (cell) {
            clearTimeout(this.hideTimeout)
            this.reposition(cell)
        } else if (!e.target.closest('.table-add-btn')) {
            // Debounce hide to allow moving to buttons
            this.hideTimeout = setTimeout(() => this.hide(), 300)
        }
    })
    
    this.overlay.addEventListener('mouseenter', () => {
        clearTimeout(this.hideTimeout)
    })
    
    this.overlay.addEventListener('mouseleave', () => {
        this.hideTimeout = setTimeout(() => this.hide(), 300)
    })
    
    this.rowBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.insertRow()
    })
    
    this.colBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.insertCol()
    })
  }
  
  reposition(cell) {
      const rect = cell.getBoundingClientRect()
      const rootRect = this.quill.container.getBoundingClientRect()
      
      const table = cell.closest('table')
      if (!table) return
      const tableRect = table.getBoundingClientRect()
      
      // Calculate relative positions
      const cellTop = rect.top - rootRect.top
      const cellLeft = rect.left - rootRect.left
      
      // Row Button: Bottom Center of the cell (Insert Below)
      this.rowBtn.style.display = 'flex'
      this.rowBtn.style.top = `${cellTop + rect.height - 8}px` // Overlap bottom border
      this.rowBtn.style.left = `${cellLeft + (rect.width / 2) - 8}px` // Center
      this.rowBtn.style.width = '16px'
      this.rowBtn.style.height = '16px'
      
      // Col Button: Right Center of the cell (Insert Right)
      this.colBtn.style.display = 'flex'
      this.colBtn.style.top = `${cellTop + (rect.height / 2) - 8}px` // Center
      this.colBtn.style.left = `${cellLeft + rect.width - 8}px` // Overlap right border
      this.colBtn.style.width = '16px'
      this.colBtn.style.height = '16px'
      
      this.targetCell = cell
  }
  
  hide() {
      this.rowBtn.style.display = 'none'
      this.colBtn.style.display = 'none'
  }
  
  insertRow() {
      if (!this.targetCell) return
      const blot = Quill.find(this.targetCell)
      if (!blot) return
      
      const index = this.quill.getIndex(blot)
      this.quill.setSelection(index, 0)
      
      const table = this.quill.getModule('table')
      if (table) {
          if (table.insertRowBelow) table.insertRowBelow()
          else table.insertRow()
      }
  }
  
  insertCol() {
      if (!this.targetCell) return
      const blot = Quill.find(this.targetCell)
      if (!blot) return
      
      const index = this.quill.getIndex(blot)
      this.quill.setSelection(index, 0)
      
      const table = this.quill.getModule('table')
      if (table) {
          if (table.insertColumnRight) table.insertColumnRight()
          else table.insertColumn()
      }
  }
}
