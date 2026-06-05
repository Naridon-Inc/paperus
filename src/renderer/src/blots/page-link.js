import Quill from 'quill'

const BlockEmbed = Quill.import('blots/block/embed')

class PageLinkBlot extends BlockEmbed {
  static create(value) {
    const node = super.create(value)
    // value = { href: string, title: string }
    
    node.setAttribute('data-href', value.href)
    node.setAttribute('data-title', value.title || 'Untitled')
    if (value.docId) {
        node.setAttribute('data-doc-id', value.docId)
    }
    
    node.innerHTML = `
        <span class="page-icon"><i class="far fa-file-alt"></i></span>
        <span class="page-text">${value.title || 'Untitled'}</span>
    `
    
    // Add click handler? 
    // Blots are static nodes. Event handling usually done globally or via onclick attribute (risky).
    // Better to handle click in main.js via delegation.
    
    return node
  }

  static value(node) {
    return {
      href: node.getAttribute('data-href'),
      title: node.getAttribute('data-title'),
      docId: node.getAttribute('data-doc-id')
    }
  }
}

PageLinkBlot.blotName = 'page-link'
PageLinkBlot.tagName = 'div' // Block behavior
PageLinkBlot.className = 'page-link-embed'

export default PageLinkBlot
