// FolderList.jsx — left rail: account switcher + special folders with unread badges.
//
// Special folders (Inbox/Sent/Drafts/Archive/Junk/Trash) are surfaced first via
// their IMAP specialUse flag; remaining folders are listed below under "Folders".

import { useMemo } from 'react'
import { Tooltip } from '@medusajs/ui'
import {
  InboxSolid, PaperPlane, Pencil, ArchiveBox, Trash, Folder, FolderOpen, Plus, ExclamationCircle, CogSixTooth,
} from '@medusajs/icons'

// Map IMAP special-use → icon + friendly label + sort weight.
const SPECIAL = {
  '\\Inbox': { icon: InboxSolid, label: 'Inbox', order: 0 },
  inbox: { icon: InboxSolid, label: 'Inbox', order: 0 },
  '\\Sent': { icon: PaperPlane, label: 'Sent', order: 1 },
  sent: { icon: PaperPlane, label: 'Sent', order: 1 },
  '\\Drafts': { icon: Pencil, label: 'Drafts', order: 2 },
  drafts: { icon: Pencil, label: 'Drafts', order: 2 },
  '\\Archive': { icon: ArchiveBox, label: 'Archive', order: 3 },
  archive: { icon: ArchiveBox, label: 'Archive', order: 3 },
  '\\Junk': { icon: ExclamationCircle, label: 'Junk', order: 4 },
  junk: { icon: ExclamationCircle, label: 'Junk', order: 4 },
  '\\Trash': { icon: Trash, label: 'Trash', order: 5 },
  trash: { icon: Trash, label: 'Trash', order: 5 },
}

function classifyFolder(f) {
  const key = (f.specialUse || '').toString()
  const byFlag = SPECIAL[key] || SPECIAL[key.toLowerCase()]
  if (byFlag) return byFlag
  const byName = SPECIAL[(f.name || '').toLowerCase()]
  if (byName) return byName
  return null
}

function FolderRow({ folder, active, onClick }) {
  const special = classifyFolder(folder)
  const Icon = special ? special.icon : (active ? FolderOpen : Folder)
  const label = special ? special.label : (folder.name || folder.path)
  const unread = Number(folder.unread) || 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pp-side-item${active ? ' pp-side-item--active' : ''}`}
    >
      <Icon aria-hidden />
      <span className="pp-side-item__label">{label}</span>
      {unread > 0 ? (
        <span className="pp-side-item__count">{unread > 999 ? '999+' : unread}</span>
      ) : null}
    </button>
  )
}

export default function FolderList({
  accounts, activeAccountId, onSelectAccount, folders, activeFolder, onSelectFolder, onAddAccount, onManage,
}) {
  const account = accounts.find((a) => a.id === activeAccountId) || accounts[0]
  const multi = accounts.length > 1

  const { specials, others } = useMemo(() => {
    const sp = []
    const ot = []
    for (const f of folders) {
      if (classifyFolder(f)) sp.push(f)
      else ot.push(f)
    }
    sp.sort((a, b) => (classifyFolder(a).order - classifyFolder(b).order))
    ot.sort((a, b) => (a.name || a.path).localeCompare(b.name || b.path))
    return { specials: sp, others: ot }
  }, [folders])

  return (
    <div className="pp-mail-side">
      {/* Account: the surface header (AiBar) already names the active mailbox, so
          the rail only surfaces a switcher when there's more than one account —
          no redundant name/email card for the common single-account case. */}
      {multi ? (
        <>
          <div className="pp-mail-accts">
            {accounts.map((a) => {
              const on = a.id === (account && account.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectAccount(a.id)}
                  className={`pp-side-item${on ? ' pp-side-item--active' : ''}`}
                  title={a.email}
                >
                  <span
                    aria-hidden
                    className="pp-avatar pp-avatar--sm"
                    style={{ background: a.color || 'var(--pp-accent)', opacity: on ? 1 : 0.9 }}
                  >
                    {(a.name || a.email || '?').trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pp-side-item__label">{a.name || a.email}</span>
                  {Number(a.unread) > 0 ? (
                    <span className="pp-side-item__count">{a.unread}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <hr className="pp-hr" style={{ margin: '4px 12px 0' }} />
        </>
      ) : null}

      {/* folders */}
      <div className="pp-mail-folders">
        {specials.map((f) => (
          <FolderRow
            key={f.path}
            folder={f}
            active={f.path === activeFolder}
            onClick={() => onSelectFolder(f.path)}
          />
        ))}
        {others.length > 0 ? (
          <div className="pp-side-sec">More</div>
        ) : null}
        {others.map((f) => (
          <FolderRow
            key={f.path}
            folder={f}
            active={f.path === activeFolder}
            onClick={() => onSelectFolder(f.path)}
          />
        ))}
        {folders.length === 0 ? (
          <div style={{ padding: '8px 15px', fontSize: 12, color: 'var(--fg-muted, #a1a1aa)' }}>No folders yet</div>
        ) : null}
      </div>

      {/* account actions pinned at the bottom */}
      <div className="pp-mail-side-foot">
        <Tooltip content="Add account">
          <button type="button" onClick={onAddAccount} className="pp-side-item" aria-label="Add account">
            <Plus aria-hidden />
            <span className="pp-side-item__label">Add account</span>
          </button>
        </Tooltip>
        <Tooltip content="Manage accounts">
          <button type="button" onClick={onManage} className="pp-side-item" aria-label="Manage accounts">
            <CogSixTooth aria-hidden />
            <span className="pp-side-item__label">Manage</span>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
