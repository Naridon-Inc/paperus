const KEY = 'defaultNoteTeamId'
import { completedTasksAtBottom, setCompletedTasksAtBottom } from './checklist'

export async function getDefaultNoteTeamId() {
  return await window.api.getSettings(KEY) || null
}

export async function openNotePreferences(manager) {
  if (document.getElementById('note-preferences-overlay')) return
  const selected = await getDefaultNoteTeamId()
  const overlay = document.createElement('div')
  overlay.id = 'note-preferences-overlay'
  overlay.className = 'settings-modal-overlay open'
  overlay.innerHTML = `
    <section role="dialog" aria-modal="true" aria-labelledby="note-preferences-title"
      style="background:var(--bg-color,#fff);color:var(--text-color,#333);padding:24px;border-radius:12px;width:420px;max-width:calc(100vw - 32px);max-height:85dvh;overflow-y:auto;box-sizing:border-box;">
      <h2 id="note-preferences-title">Settings</h2>
      <label for="default-note-team">Default location for new notes</label>
      <select id="default-note-team" style="display:block;width:100%;font-size:16px;margin:12px 0;padding:10px;"></select>
      <p style="font-size:13px;line-height:1.5;">New notes in a team are shared with its members and sync across your devices. This preference is saved on this device.</p>
      <label style="display:flex;gap:10px;align-items:start;font-size:14px;margin:18px 0;">
        <input type="checkbox" id="completed-tasks-bottom" style="margin-top:3px;">
        <span>Move completed checklist items to the bottom</span>
      </label>
      <p style="font-size:13px;line-height:1.5;">Completed items are crossed out and move to the end. Uncheck an item to return it to its original place. Shared notes keep the same list order on all devices. Create a checklist with / → To-do list.</p>
      <p id="note-preferences-status" role="status" style="font-size:13px;"></p>
      <button class="btn" id="note-preferences-close" type="button">Done</button>
    </section>`
  const select = overlay.querySelector('select')
  const checklist = overlay.querySelector('#completed-tasks-bottom')
  checklist.checked = completedTasksAtBottom()
  checklist.onchange = async () => {
    try {
      await setCompletedTasksAtBottom(checklist.checked)
      overlay.querySelector('[role="status"]').textContent = 'Saved'
    } catch {
      overlay.querySelector('[role="status"]').textContent = 'Could not save. Please try again.'
    }
  }
  select.add(new Option('Private — on this device', ''))
  const teams = manager?.getTeams() || []
  for (const team of teams) select.add(new Option(team.name, team.teamId))
  if (selected && !teams.some(team => team.teamId === selected)) {
    const missing = new Option('Unavailable team — choose another location', selected)
    missing.disabled = true
    select.add(missing)
  }
  select.value = selected || ''
  select.onchange = async () => {
    try {
      await window.api.setSettings(KEY, select.value || null)
      overlay.querySelector('[role="status"]').textContent = 'Saved'
    } catch {
      overlay.querySelector('[role="status"]').textContent = 'Could not save. Please try again.'
    }
  }
  const previousFocus = document.activeElement
  const close = () => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
    window.appState.isSettingsOpen = false
    previousFocus?.focus()
  }
  const onKey = event => {
    if (event.key === 'Escape') close()
    if (event.key === 'Tab') {
      const first = select, last = overlay.querySelector('button')
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }
  overlay.querySelector('button').onclick = close
  overlay.onclick = event => { if (event.target === overlay) close() }
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
  window.appState.isSettingsOpen = true
  select.focus()
}
