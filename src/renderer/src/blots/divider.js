import Quill from 'quill'

const BlockEmbed = Quill.import('blots/block/embed')

class DividerBlot extends BlockEmbed {
  static create() {
    const node = super.create()
    return node
  }
}

DividerBlot.blotName = 'divider'
DividerBlot.tagName = 'hr'

export default DividerBlot
