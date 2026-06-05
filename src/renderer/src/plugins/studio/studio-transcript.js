/**
 * Plugin Studio — streamed AgentEvent transcript.
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §5.2):
 *   Exports `mountTranscript(el)` → `{ push(ev), clear() }`.
 *   Renders the streamed `AgentEvent` log (text/tool/file/status/error/done).
 *
 * AgentEvent (§4.1):
 *   { type:'text',   text }
 *   { type:'tool',   name, input }
 *   { type:'file',   path, action:'write'|'create'|'delete' }
 *   { type:'status', text }
 *   { type:'error',  text }
 *   { type:'done',   summary }
 *
 * CSS class contract (styled by studio.css):
 *   .studio-ev (row) + modifier .text|.tool|.file|.status|.error|.done,
 *   .studio-ev-icon, .studio-ev-body, .studio-ev-pre.
 *
 * Web-safe: no node/electron imports; pure DOM. Never throws out of push()/clear().
 */

const ICONS = {
  text: '💬',
  tool: '🔧',
  file: '📄',
  status: '…',
  error: '⚠',
  done: '✓',
};

const ACTION_VERB = {
  write: 'wrote',
  create: 'created',
  delete: 'deleted',
};

function elem(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/** Pretty-print a tool input object for the <pre>, capped so a huge blob can't blow up the DOM. */
function stringifyInput(input) {
  if (input == null) return '';
  let s;
  if (typeof input === 'string') {
    s = input;
  } else {
    try { s = JSON.stringify(input, null, 2); } catch (_) { s = String(input); }
  }
  if (s.length > 4000) s = `${s.slice(0, 4000)}…`;
  return s;
}

/**
 * @param {HTMLElement} el  the `.studio-transcript` container
 * @returns {{ push: (ev:object)=>void, clear: ()=>void }}
 */
export function mountTranscript(el) {
  // Tolerate a missing/invalid element so plugin-studio.js's try/catch fallback
  // is never the only guard.
  const root = el && el.appendChild ? el : document.createElement('div');

  function autoScroll() {
    try { root.scrollTop = root.scrollHeight; } catch (_) { /* noop */ }
  }

  function makeRow(type) {
    const row = elem('div', `studio-ev ${type}`);
    const icon = elem('span', 'studio-ev-icon', ICONS[type] || '•');
    const body = elem('div', 'studio-ev-body');
    row.appendChild(icon);
    row.appendChild(body);
    return { row, body };
  }

  function push(ev) {
    try {
      if (!ev || typeof ev !== 'object') return;
      const type = typeof ev.type === 'string' ? ev.type : 'status';

      switch (type) {
        case 'text': {
          const { row, body } = makeRow('text');
          body.textContent = String(ev.text || '');
          root.appendChild(row);
          break;
        }
        case 'tool': {
          const { row, body } = makeRow('tool');
          body.textContent = String(ev.name || 'tool');
          const inputStr = stringifyInput(ev.input);
          if (inputStr) {
            const pre = elem('pre', 'studio-ev-pre', inputStr);
            body.appendChild(pre);
          }
          root.appendChild(row);
          break;
        }
        case 'file': {
          const { row, body } = makeRow('file');
          const verb = ACTION_VERB[ev.action] || (ev.action ? String(ev.action) : 'changed');
          body.textContent = `${verb} ${String(ev.path || '')}`;
          root.appendChild(row);
          break;
        }
        case 'error': {
          const { row, body } = makeRow('error');
          body.textContent = String(ev.text || 'Unknown error');
          root.appendChild(row);
          break;
        }
        case 'done': {
          const { row, body } = makeRow('done');
          body.textContent = String(ev.summary || 'Done');
          root.appendChild(row);
          break;
        }
        case 'status':
        default: {
          const { row, body } = makeRow('status');
          body.textContent = String(ev.text || '');
          root.appendChild(row);
          break;
        }
      }
      autoScroll();
    } catch (_) { /* never throw out of the transcript */ }
  }

  function clear() {
    try {
      while (root.firstChild) root.removeChild(root.firstChild);
    } catch (_) { /* noop */ }
  }

  return { push, clear };
}

export default mountTranscript;
