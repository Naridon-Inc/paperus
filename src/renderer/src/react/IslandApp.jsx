// IslandApp.jsx — the shell every island renders into. Establishes the
// `#react-root.medusa-island` scope (Tailwind utilities are emitted as
// `#react-root .x`, so they can only apply here) and provides the host bridge.
import { Suspense, lazy, useEffect, useState } from 'react'
import { HostProvider } from './host.js'
import './island.css'

// Resolve the app's current theme from the vanilla contract (<html
// data-theme="dark">, set by theme.js). Default to light if unset.
function readTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

// Mirror the app theme onto the island root. Tailwind's `darkMode: 'class'`
// means putting `dark` on `#react-root` flips Medusa's entire token set (and,
// through it, every `.pp-*` surface) for free — no per-surface restyling.
function useIslandTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const onChange = (e) => {
      const next = e && e.detail && e.detail.theme ? e.detail.theme : readTheme()
      setTheme(next)
    }
    window.addEventListener('theme:changed', onChange)
    // Re-sync once on mount in case the theme changed before this island
    // mounted (islands are lazy and may attach after a toggle).
    setTheme(readTheme())
    return () => window.removeEventListener('theme:changed', onChange)
  }, [])
  return theme
}

// Static-literal dynamic imports so rollup can code-split each surface. Stub
// files exist for all four keys, so the build always resolves; the crew fills
// them in.
const SURFACES = {
  tasks: lazy(() => import('./surfaces/Tasks.jsx')),
  calendar: lazy(() => import('./surfaces/Calendar.jsx')),
  inbox: lazy(() => import('./surfaces/Inbox.jsx')),
  email: lazy(() => import('./surfaces/Email.jsx')),
}

export default function IslandApp({ surfaceKey, host }) {
  const Surface = SURFACES[surfaceKey]
  const theme = useIslandTheme()
  return (
    <div
      id="react-root"
      className={`medusa-island${theme === 'dark' ? ' dark' : ''}`}
      data-theme={theme}
      style={{ height: '100%', width: '100%' }}
    >
      <HostProvider host={host}>
        <Suspense fallback={<div className="p-8 text-ui-fg-muted">Loading…</div>}>
          {Surface
            ? <Surface />
            : <div className="p-8 text-ui-fg-base">Unknown surface: {String(surfaceKey)}</div>}
        </Suspense>
      </HostProvider>
    </div>
  )
}
