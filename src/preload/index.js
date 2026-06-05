import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // General Invoke Helper
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // Settings
  getSettings: (key) => ipcRenderer.invoke('settings:get', key),
  setSettings: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  hasSettings: (key) => ipcRenderer.invoke('settings:has', key),

  // File System
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, contents) => ipcRenderer.invoke('fs:writeFile', path, contents),
  createFile: (path) => ipcRenderer.invoke('fs:createFile', path),
  pathExists: (path) => ipcRenderer.invoke('fs:pathExists', path),
  basename: (path, ext) => ipcRenderer.invoke('path:basename', path, ext),
  extname: (path) => ipcRenderer.invoke('path:extname', path),

  // Dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),

  // Git-repo sync (Obsidian-style)
  git: {
    status: (dir) => ipcRenderer.invoke('git:status', dir),
    init: (dir, remoteUrl) => ipcRenderer.invoke('git:init', dir, remoteUrl),
    setRemote: (dir, url) => ipcRenderer.invoke('git:setRemote', dir, url),
    sync: (dir, opts) => ipcRenderer.invoke('git:sync', dir, opts),
    clone: (dir, url, token) => ipcRenderer.invoke('git:clone', dir, url, token),
  },

  // Windows
  getCurrentWindowPath: () => ipcRenderer.invoke('win:getPath'),

  // Events
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  onMessage: (callback) => ipcRenderer.on('message', (_event, ...args) => callback(...args)),

  // OAuth deep-link callback (desktop): main forwards the JWT here after the
  // system browser completes GitHub/Google sign-in.
  onAuthToken: (callback) =>
    ipcRenderer.on('auth:oauth-token', (_event, token, error) => callback(token, error))
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}

