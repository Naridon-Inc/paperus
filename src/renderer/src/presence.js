import { Awareness } from 'y-protocols/awareness'

/**
 * PresenceManager handles presence broadcasting via Yjs Awareness.
 * With CodeMirror 6 + y-codemirror.next, cursor rendering is handled
 * natively by yCollab. This manager only handles user metadata and typing state.
 */
export class PresenceManager {
  constructor(doc, awareness) {
    this.doc = doc
    this.awareness = awareness || new Awareness(doc)

    window.addEventListener('presence:update', () => {})
  }

  /**
   * Bind is now a no-op for editor cursors.
   * y-codemirror.next handles cursor rendering natively via yCollab.
   */
  bind() {
    // Scrub any old-format cursor data (plain {index, length} objects)
    // that would crash y-codemirror.next's RelativePosition parser
    this.awareness.getStates().forEach((state, clientId) => {
      if (state.cursor && typeof state.cursor.index === 'number') {
        if (clientId === this.awareness.clientID) {
          this.awareness.setLocalStateField('cursor', null)
        }
      }
    })
  }

  // Legacy alias
  bindQuill() {
    this.bind()
  }

  unbindQuill() {
    // No-op — y-codemirror.next manages its own lifecycle
  }

  setUser(user) {
    this.awareness.setLocalStateField('user', {
      name: user.name,
      color: user.color,
      id: user.id,
      email: user.email,
      isTyping: false
    })
  }

  setTyping(isTyping) {
    const user = this.awareness.getLocalState()?.user
    if (user) {
        this.awareness.setLocalStateField('user', { ...user, isTyping })
        window.dispatchEvent(new CustomEvent('presence:update'))
    }
  }

  /**
   * No-op: y-codemirror.next manages cursor positions internally
   * using Yjs RelativePositions. Writing plain {index, length} objects
   * here would crash yCollab's RelativePosition parser.
   */
  updateCursor(range) {
    // Intentionally empty
  }

  generateColor(email) {
    if (!email) return '#777';
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
        hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 45%)`;
  }

  destroy() {
    console.log('[Presence] Destroying presence manager for', this.doc.guid);
  }
}
