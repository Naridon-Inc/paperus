// Admin panel for the self-hosted web app — the super-admin's control surface.
//
// Mounts only for signed-in users whose role is `admin` (checked via
// /api/account/me). Renders a subtle floating "Members" launcher; opening it
// shows a roster with the actions a self-hosted instance actually needs:
// invite/create users (so a "closed" instance can grow), disable/enable, reset
// passwords, promote/demote, and delete. The backend (accounts.js) refuses to
// lock out the last admin, so the panel can't orphan the instance.
//
// Dependency-free and self-contained (inline styles), same as account-gate.js —
// all requests are same-origin so the HttpOnly session cookie just works. This
// is an ACCESS layer only: it never sees or touches note keys (notes stay E2EE).

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty */ }
  return { ok: res.ok, status: res.status, body: data };
}

const ADMIN_ERRORS = {
  invalid_email: 'That email address looks off.',
  weak_password: 'Password must be at least 8 characters.',
  email_taken: 'An account with that email already exists.',
  last_admin: "That's the last admin — promote someone else first.",
  cannot_disable_self: "You can't disable your own account.",
  cannot_demote_self: "You can't demote your own account.",
  cannot_delete_self: "You can't delete your own account.",
  not_found: 'That user no longer exists.',
  forbidden: 'Admins only.',
};
function msg(err) { return ADMIN_ERRORS[err] || (err ? `Error: ${err}` : 'Something went wrong.'); }

export async function mountAdminPanel() {
  let me;
  try {
    const r = await api('GET', '/api/account/me');
    if (!r.ok) return; // not signed in / accounts off
    me = r.body && r.body.user;
  } catch (e) { return; }
  if (!me || me.role !== 'admin') return; // members don't get the panel

  injectStyles();

  const launcher = document.createElement('button');
  launcher.setAttribute('data-nl-admin-launch', '');
  launcher.innerHTML = '<span class="nl-a-dot"></span> Members';
  launcher.title = 'Manage members (admin)';
  document.body.appendChild(launcher);
  launcher.onclick = () => openPanel(me);
}

function injectStyles() {
  if (document.getElementById('nl-admin-styles')) return;
  const s = document.createElement('style');
  s.id = 'nl-admin-styles';
  s.textContent = `
    [data-nl-admin-launch]{position:fixed;left:16px;bottom:16px;z-index:99990;
      display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border-radius:10px;
      border:1px solid rgba(120,200,170,.22);background:rgba(18,32,28,.92);color:#cfe7dc;
      font:600 12.5px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      cursor:pointer;box-shadow:0 8px 24px -10px rgba(0,0,0,.6);backdrop-filter:blur(6px);}
    [data-nl-admin-launch]:hover{border-color:#37b88a;color:#eaf5f0;}
    [data-nl-admin-launch] .nl-a-dot{width:9px;height:9px;border-radius:50%;
      background:linear-gradient(150deg,#4ade9f,#1f8f6b);display:inline-block;}
    [data-nl-admin]{position:fixed;inset:0;z-index:99991;display:flex;align-items:center;
      justify-content:center;padding:24px;background:rgba(4,10,8,.62);backdrop-filter:blur(3px);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8f3ee;}
    [data-nl-admin] .nl-a-card{width:100%;max-width:640px;max-height:82vh;overflow:auto;
      background:#10201b;border:1px solid rgba(120,200,170,.16);border-radius:16px;
      padding:22px 22px 18px;box-shadow:0 30px 70px -24px rgba(0,0,0,.7);}
    [data-nl-admin] .nl-a-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
    [data-nl-admin] .nl-a-title{font-weight:680;font-size:16px;}
    [data-nl-admin] .nl-a-x{background:none;border:0;color:#9fc0b4;font-size:20px;cursor:pointer;line-height:1;}
    [data-nl-admin] .nl-a-sub{color:#9fc0b4;font-size:12.5px;margin:2px 0 16px;}
    [data-nl-admin] .nl-a-row{display:flex;align-items:center;gap:10px;padding:10px 0;
      border-top:1px solid rgba(120,200,170,.10);}
    [data-nl-admin] .nl-a-em{font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    [data-nl-admin] .nl-a-badge{font-size:10.5px;font-weight:650;padding:2px 7px;border-radius:6px;
      background:rgba(120,200,170,.14);color:#aee3cd;}
    [data-nl-admin] .nl-a-badge.admin{background:rgba(95,224,170,.18);color:#7ff0bf;}
    [data-nl-admin] .nl-a-badge.off{background:rgba(255,120,120,.16);color:#ffb3b3;}
    [data-nl-admin] .nl-a-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
    [data-nl-admin] .nl-a-acts button{font-size:11.5px;padding:5px 9px;border-radius:7px;cursor:pointer;
      border:1px solid rgba(120,200,170,.22);background:rgba(8,18,15,.7);color:#cfe7dc;}
    [data-nl-admin] .nl-a-acts button:hover{border-color:#37b88a;color:#eaf5f0;}
    [data-nl-admin] .nl-a-acts button.danger:hover{border-color:#e06666;color:#ffcaca;}
    [data-nl-admin] .nl-a-bar{display:flex;gap:8px;margin:16px 0 4px;flex-wrap:wrap;}
    [data-nl-admin] .nl-a-bar button{flex:1;min-width:120px;padding:9px 12px;border-radius:9px;border:0;
      font-weight:640;font-size:13px;cursor:pointer;}
    [data-nl-admin] .nl-a-bar .primary{background:linear-gradient(150deg,#3ed598,#1f9f74);color:#06231a;}
    [data-nl-admin] .nl-a-bar .ghost{background:rgba(8,18,15,.7);color:#cfe7dc;border:1px solid rgba(120,200,170,.22);}
    [data-nl-admin] .nl-a-note{font-size:12px;color:#9fc0b4;margin-top:8px;min-height:15px;}
    [data-nl-admin] .nl-a-note.err{color:#ff9b9b;}
    [data-nl-admin] .nl-a-sec{margin-top:18px;font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;color:#6f8c82;}
    [data-nl-admin] .nl-a-inv{display:flex;align-items:center;gap:10px;padding:9px 0;
      border-top:1px solid rgba(120,200,170,.10);font-size:12.5px;}
    [data-nl-admin] .nl-a-inv code{font-size:11px;color:#aee3cd;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    [data-nl-admin] .nl-a-foot{margin-top:16px;display:flex;justify-content:space-between;align-items:center;
      font-size:11.5px;color:#6f8c82;}
    [data-nl-admin] .nl-a-foot a{color:#5fe0aa;cursor:pointer;}`;
  document.head.appendChild(s);
}

function openPanel(me) {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-nl-admin', '');
  wrap.innerHTML = `
    <div class="nl-a-card">
      <div class="nl-a-head">
        <div class="nl-a-title">Members</div>
        <button class="nl-a-x" data-x title="Close">&times;</button>
      </div>
      <div class="nl-a-sub">Access to this instance. Notes stay end-to-end encrypted — these controls never touch your content.</div>
      <div data-note class="nl-a-note"></div>
      <div data-list></div>
      <div class="nl-a-bar">
        <button class="primary" data-invite>Invite by link</button>
        <button class="ghost" data-create>Add user directly</button>
      </div>
      <div data-invites></div>
      <div class="nl-a-foot">
        <span>Signed in as ${escapeHtml(me.email)}</span>
        <a data-logout>Sign out</a>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const noteEl = wrap.querySelector('[data-note]');
  const listEl = wrap.querySelector('[data-list]');
  const invitesEl = wrap.querySelector('[data-invites]');
  function note(text, isErr) { noteEl.textContent = text || ''; noteEl.className = `nl-a-note${isErr ? ' err' : ''}`; }

  function close() { wrap.remove(); }
  wrap.querySelector('[data-x]').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

  wrap.querySelector('[data-logout]').onclick = async () => {
    await api('POST', '/api/account/logout');
    window.location.reload();
  };

  async function refresh() {
    const r = await api('GET', '/api/admin/users');
    if (!r.ok) { note(msg(r.body && r.body.error), true); return; }
    renderUsers(r.body.users || []);
    renderInvites(r.body.invites || []);
  }

  function renderUsers(users) {
    listEl.innerHTML = '';
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'nl-a-row';
      const isSelf = u.id === me.id;
      row.innerHTML = `
        <span class="nl-a-em">${escapeHtml(u.email)}${isSelf ? ' (you)' : ''}</span>
        <span class="nl-a-badge ${u.role === 'admin' ? 'admin' : ''}">${u.role}</span>
        ${u.disabled ? '<span class="nl-a-badge off">disabled</span>' : ''}
        <span class="nl-a-acts"></span>`;
      const acts = row.querySelector('.nl-a-acts');
      const add = (label, fn, danger) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (danger) b.className = 'danger';
        b.onclick = fn;
        acts.appendChild(b);
      };
      add(u.role === 'admin' ? 'Make member' : 'Make admin', () => act('/api/admin/set-role', { id: u.id, role: u.role === 'admin' ? 'member' : 'admin' }));
      add(u.disabled ? 'Enable' : 'Disable', () => act('/api/admin/disable', { id: u.id, disabled: !u.disabled }));
      add('Reset password', async () => {
        const pw = window.prompt(`New password for ${u.email} (min 8 chars):`);
        if (pw) act('/api/admin/reset-password', { id: u.id, password: pw });
      });
      if (!isSelf) add('Delete', async () => { if (window.confirm(`Delete ${u.email}? They lose access to this instance.`)) act('DELETE-USER', u.id); }, true);
      listEl.appendChild(row);
    });
  }

  function renderInvites(invites) {
    invitesEl.innerHTML = invites.length ? '<div class="nl-a-sec">Pending invites</div>' : '';
    invites.forEach((inv) => {
      const row = document.createElement('div');
      row.className = 'nl-a-inv';
      const when = new Date(inv.exp).toLocaleDateString();
      row.innerHTML = `<code>${escapeHtml(inv.email || 'anyone')} · ${inv.role} · expires ${when}</code>
        <span class="nl-a-acts"><button data-rev>Revoke</button></span>`;
      row.querySelector('[data-rev]').onclick = () => act('/api/admin/revoke-invite', { id: inv.id });
      invitesEl.appendChild(row);
    });
  }

  async function act(path, body) {
    let r;
    if (path === 'DELETE-USER') r = await api('DELETE', `/api/admin/users/${body}`);
    else r = await api('POST', path, body);
    if (!r.ok) { note(msg(r.body && r.body.error), true); return; }
    note('');
    refresh();
  }

  wrap.querySelector('[data-invite]').onclick = async () => {
    const email = (window.prompt('Pin this invite to an email address? Leave blank for anyone with the link:') || '').trim();
    const makeAdmin = window.confirm('Grant ADMIN to whoever accepts this invite?\n\nOK = admin, Cancel = member.');
    const r = await api('POST', '/api/admin/invite', { email: email || undefined, role: makeAdmin ? 'admin' : 'member' });
    if (!r.ok) { note(msg(r.body && r.body.error), true); return; }
    const url = r.body.url;
    try { await navigator.clipboard.writeText(url); note('Invite link copied to clipboard. Share it with the new member.'); } catch (e) { window.prompt('Invite link — copy and share:', url); }
    refresh();
  };

  wrap.querySelector('[data-create]').onclick = async () => {
    const email = (window.prompt('New member email:') || '').trim();
    if (!email) return;
    const password = window.prompt('Temporary password (min 8 chars) — share it with them:');
    if (!password) return;
    const makeAdmin = window.confirm('Make this user an ADMIN?\n\nOK = admin, Cancel = member.');
    const r = await api('POST', '/api/admin/users', { email, password, role: makeAdmin ? 'admin' : 'member' });
    if (!r.ok) { note(msg(r.body && r.body.error), true); return; }
    note(`Created ${email}. They sign in with the password you set.`);
    refresh();
  };

  refresh();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
