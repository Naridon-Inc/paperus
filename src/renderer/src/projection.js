export class ProjectionManager {
  constructor(engine, path) {
    this.engine = engine
    this.path = path
    this.debouncedSave = null
    this.textObserver = this.onTextChange.bind(this)
  }

  mount() {
    console.log('[Projection] Mounted for:', this.path)
    this.engine.text.observe(this.textObserver)
  }

  destroy() {
      console.log('[Projection] Destroying projection for:', this.path);
      if (this.debouncedSave) {
          clearTimeout(this.debouncedSave);
          this.debouncedSave = null;
      }
      if (this.engine && this.engine.text) {
          this.engine.text.unobserve(this.textObserver);
      }
  }

  onTextChange(event) {
    if (event.transaction.origin === 'user') return
    this.scheduleSave()
  }

  async reconcile() {
    return;
  }

  async checkExternalChange() {
    if (!this.path) return;
    if (this.debouncedSave || window.isUpdatingFromYjs) return;

    try {
        const diskContent = await window.api.readFile(this.path);
        const editorContent = this.engine.text.toString();

        if (diskContent.trim() === editorContent.trim()) return;

        console.log('[Projection] External change detected in:', this.path);

        const result = await window.api.invoke('dialog:showMessageBox', {
            type: 'warning',
            title: 'File Conflict Detected',
            message: `The file "${await window.api.basename(this.path)}" has been modified by another application.`,
            detail: 'Which version do you want to keep?',
            buttons: ['Keep Opus Version', 'Load Disk Version', 'Cancel'],
            defaultId: 0,
            cancelId: 2
        });

        if (result.response === 1) {
            console.log('[Projection] Overwriting internal state with disk version');
            window.isUpdatingFromYjs = true;

            this.engine.doc.transact(() => {
                this.engine.text.delete(0, this.engine.text.length);
                this.engine.text.insert(0, diskContent);
            }, 'external-reload');

            window.isUpdatingFromYjs = false;
        } else if (result.response === 0) {
            console.log('[Projection] Overwriting disk with Opus version');
            this.scheduleSave();
        }
    } catch (e) {
        console.error('[Projection] Conflict check failed:', e);
    }
  }

  scheduleSave() {
    if (this.debouncedSave) clearTimeout(this.debouncedSave)

    this.debouncedSave = setTimeout(async () => {
      if (window.isUpdatingFromYjs) {
          console.log('[Projection] Save deferred: Global update in progress');
          return;
      }

      const content = this.engine.text.toString();

      // Data loss prevention: if content is empty but yText had content, block save
      if ((!content || content.trim().length === 0) && this.engine.text.length > 10) {
          console.warn('[Projection] Blocking save: content appears empty while Yjs has data');
          return;
      }

      if (!this.path) return;

      try {
          await window.api.writeFile(this.path, content)
          console.log('[Projection] Saved to disk:', this.path);
      } catch (e) {
          console.error('[Projection] Write failed:', e);
      }
    }, 2000)
  }
}
