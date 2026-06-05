export class ExportModal {
    constructor() {
        this.isOpen = false
        this.render()
    }

    render() {
        const div = document.createElement('div')
        div.className = 'export-modal-overlay'
        div.style.display = 'none'
        
        div.innerHTML = `
            <div class="export-modal">
                <div class="export-header">
                    <h3>Export</h3>
                </div>
                
                <div class="export-body">
                    <div class="export-row">
                        <label>Export format</label>
                        <select id="export-format">
                            <option value="pdf">PDF</option>
                            <option value="html">HTML</option>
                            <option value="md">Markdown & CSV</option>
                        </select>
                    </div>
                    
                    <div class="export-row" id="row-include-content">
                        <label>Include content</label>
                        <select id="export-content">
                            <option value="everything">Everything</option>
                            <option value="no-files">No images/files</option>
                        </select>
                    </div>
                    
                    <div class="export-row" id="row-page-format">
                        <label>Page format</label>
                        <select id="export-pageSize">
                            <option value="A4">A4</option>
                            <option value="Letter">Letter</option>
                            <option value="Legal">Legal</option>
                            <option value="A3">A3</option>
                            <option value="Tabloid">Tabloid</option>
                        </select>
                    </div>
                    
                    <div class="export-row" id="row-scale">
                        <label>Scale percent</label>
                        <input type="number" id="export-scale" value="100" min="10" max="200" style="width: 60px;">
                    </div>
                    
                    <div class="export-row">
                        <label>Include subpages</label>
                        <div class="toggle-switch" id="export-subpages"></div>
                    </div>
                    
                    <div class="export-row">
                        <label>Create folders for subpages</label>
                        <div class="toggle-switch active" id="export-folders"></div>
                    </div>
                </div>
                
                <div class="export-footer">
                    <button class="btn-text" id="export-cancel">Cancel</button>
                    <button class="btn-primary" id="export-confirm">Export</button>
                </div>
            </div>
        `
        document.body.appendChild(div)
        this.el = div
        
        // Event Listeners
        this.el.addEventListener('click', (e) => {
            if (e.target === this.el) this.close()
        })
        
        this.el.querySelector('#export-cancel').addEventListener('click', () => this.close())
        this.el.querySelector('#export-confirm').addEventListener('click', () => this.handleExport())
        
        // Toggle Logic
        this.el.querySelectorAll('.toggle-switch').forEach(t => {
            t.addEventListener('click', () => t.classList.toggle('active'))
        })
        
        // Format Change Logic
        const formatSelect = this.el.querySelector('#export-format')
        formatSelect.addEventListener('change', () => {
            const format = formatSelect.value
            const pdfRows = this.el.querySelectorAll('#row-page-format, #row-scale')
            
            if (format === 'pdf') {
                pdfRows.forEach(r => r.style.display = 'flex')
            } else {
                pdfRows.forEach(r => r.style.display = 'none')
            }
        })
    }

    open() {
        this.isOpen = true
        this.el.style.display = 'flex'
    }

    close() {
        this.isOpen = false
        this.el.style.display = 'none'
    }

    async handleExport() {
        const format = this.el.querySelector('#export-format').value
        const button = this.el.querySelector('#export-confirm')
        
        button.disabled = true
        button.textContent = 'Exporting...'
        
        try {
            if (format === 'pdf') {
                const pageSize = this.el.querySelector('#export-pageSize').value
                const scaleInput = parseInt(this.el.querySelector('#export-scale').value) || 100
                const scale = scaleInput // Just pass it directly, main process expects integer 10-200 and converts to 0.1-2.0 if needed?
                // Wait, main process calls: scale: (options.scale || 100) / 100
                // So if user types 100, main process gets 1.0. Correct.
                
                // Add print class to body to trigger CSS
                document.body.classList.add('printing')
                
                // Delay slightly to let styles apply
                await new Promise(r => requestAnimationFrame(r))
                
                const filename = document.getElementById('doc-title').value || 'document'
                
                await window.api.invoke('export:pdf', {
                    pageSize,
                    scale,
                    filename
                })
                
                document.body.classList.remove('printing')
            } else if (format === 'html') {
                // ... (Existing HTML logic)
                alert('HTML Export not fully implemented yet')
            } else {
                // ... (Existing MD logic)
                alert('Markdown Export: Use "Save As" for now')
            }
            this.close()
        } catch (e) {
            console.error(e)
            if (e.message.includes('No handler registered')) {
                alert('Update requires app restart. Please restart the application to enable PDF export.')
            } else {
                alert('Export failed: ' + e.message)
            }
        } finally {
            button.disabled = false
            button.textContent = 'Export'
            document.body.classList.remove('printing') // Safety
        }
    }
}