export class TableOfContents {
    constructor(quill) {
        this.quill = quill
        this.container = document.getElementById('toc-container')
        this.render()
        
        // Listen for changes
        this.quill.on('text-change', () => this.render())
    }
    
    render() {
        if (!this.container) return
        
        this.container.innerHTML = ''
        const delta = this.quill.getContents()
        
        let index = 0
        delta.ops.forEach(op => {
            const len = typeof op.insert === 'string' ? op.insert.length : 1
            
            if (op.attributes && op.attributes.header) {
                // It's a header
                // Find the text content for this header (usually previous op)
                // Quill headers are usually newline chars with attributes, preceded by text
                
                // Better approach: Scan lines using Quill API
            }
            index += len
        })
        
        // Simpler Scan: Iterate lines
        const lines = this.quill.getLines()
        lines.forEach(line => {
            const format = line.domNode.tagName
            if (['H1', 'H2', 'H3'].includes(format)) {
                const level = format
                const text = line.domNode.textContent
                const offset = this.quill.getIndex(line)
                
                const item = document.createElement('div')
                item.className = `toc-item toc-${level.toLowerCase()}`
                item.dataset.title = text
                item.title = text // Tooltip on hover
                item.onclick = () => {
                    this.quill.setSelection(offset, 0)
                    this.quill.scrollIntoView()
                }
                
                this.container.appendChild(item)
            }
        })
        
        // Hide if empty
        this.container.style.display = this.container.children.length > 0 ? 'flex' : 'none'
    }
}
