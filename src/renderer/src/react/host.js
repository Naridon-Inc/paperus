// host.js — React context carrying the vanilla app's "host bridge" into islands.
//
// Surfaces never import vanilla app modules directly. They call `useHost()` and
// talk to the app through the bridge contract built in host-bridge.js. This keeps
// the React/vanilla seam one-directional: islands depend on the host, never the
// reverse.
import React, { createContext, useContext } from 'react'

const HostContext = createContext(null)

export function HostProvider({ host, children }) {
  return React.createElement(HostContext.Provider, { value: host }, children)
}

export function useHost() {
  const host = useContext(HostContext)
  if (!host) throw new Error('useHost() must be used inside <HostProvider>')
  return host
}
