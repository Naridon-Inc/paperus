import Quill from 'quill'

const Block = Quill.import('blots/block')

class ToggleItem extends Block {
  static create(value) {
    const node = super.create()
    node.setAttribute('data-toggle', 'true')
    
    // Create Icon
    const icon = document.createElement('span')
    icon.className = 'toggle-icon'
    icon.innerHTML = '<i class="fas fa-caret-right"></i>'
    icon.contentEditable = false
    
    // Prepend icon
    node.prepend(icon)
    
    return node
  }

  static formats(node) {
    // Return formats represented by this node
    return {
        collapsed: node.hasAttribute('data-collapsed')
    }
  }

  format(name, value) {
    if (name === 'collapsed') {
      if (value) {
        this.domNode.setAttribute('data-collapsed', 'true')
        this.domNode.classList.add('collapsed')
      } else {
        this.domNode.removeAttribute('data-collapsed')
        this.domNode.classList.remove('collapsed')
      }
    } else {
      super.format(name, value)
    }
  }
}

ToggleItem.blotName = 'toggle-item'
ToggleItem.tagName = 'div'
ToggleItem.className = 'toggle-item'

export default ToggleItem
