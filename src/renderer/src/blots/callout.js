import Quill from 'quill'

const Block = Quill.import('blots/block')

class CalloutBlot extends Block {
  static create(value) {
    const node = super.create(value)
    // Default icon if boolean true, else use value as icon?
    // Callout usually has content AND icon.
    // Simplifying: Just a styled block for now. Content is children.
    // But how to add icon? 
    // Maybe use a dataset attribute for the icon.
    if (typeof value === 'string') {
        node.setAttribute('data-icon', value)
    } else {
        node.setAttribute('data-icon', '💡')
    }
    return node
  }

  static formats(node) {
    return node.getAttribute('data-icon')
  }
}

CalloutBlot.blotName = 'callout'
CalloutBlot.tagName = 'div'
CalloutBlot.className = 'callout-block'

export default CalloutBlot
