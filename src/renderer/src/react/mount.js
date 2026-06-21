// mount.js — lazy React-island lifecycle. The whole React/Medusa runtime is
// dynamically imported on first use, so the vanilla app's startup cost is
// unchanged until a surface is actually opened.
//
// One root per container element. main.js calls mountReactSurface() when a
// surface tab is shown and unmountReactSurface() from tab-manager's onTabClose.

const roots = new Map() // container element -> ReactDOM root

export async function mountReactSurface(container, key, host) {
  if (!container) return null
  const [{ createRoot }, reactMod, appMod] = await Promise.all([
    import('react-dom/client'),
    import('react'),
    import('./IslandApp.jsx'),
  ])
  const React = reactMod.default || reactMod
  const IslandApp = appMod.default
  let root = roots.get(container)
  if (!root) {
    root = createRoot(container)
    roots.set(container, root)
  }
  root.render(React.createElement(IslandApp, { surfaceKey: key, host }))
  return root
}

export function unmountReactSurface(container) {
  const root = roots.get(container)
  if (!root) return
  // Defer unmount out of any in-flight React render to avoid the
  // "synchronously unmount during render" warning.
  setTimeout(() => {
    try { root.unmount() } catch (_e) { /* already gone */ }
  }, 0)
  roots.delete(container)
}

export function isSurfaceMounted(container) {
  return roots.has(container)
}
