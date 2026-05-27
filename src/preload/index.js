import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe, typed API surface to the renderer
contextBridge.exposeInMainWorld('api', {
  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: {
    saveCredentials: (email, password) =>
      ipcRenderer.invoke('auth:save-credentials', email, password),
    getCredentials: () =>
      ipcRenderer.invoke('auth:get-credentials'),
    deleteCredentials: () =>
      ipcRenderer.invoke('auth:delete-credentials')
  },

  // ── IMAP ────────────────────────────────────────────────────────────────────
  imap: {
    connect: (email, password) =>
      ipcRenderer.invoke('imap:connect', email, password),
    disconnect: () =>
      ipcRenderer.invoke('imap:disconnect'),
    getFolders: () =>
      ipcRenderer.invoke('imap:get-folders'),
    fetchMessages: (folder, page, pageSize) =>
      ipcRenderer.invoke('imap:fetch-messages', folder, page, pageSize),
    fetchBody: (folder, uid) =>
      ipcRenderer.invoke('imap:fetch-body', folder, uid),
    markRead: (folder, uid, read) =>
      ipcRenderer.invoke('imap:mark-read', folder, uid, read),
    starMessage: (folder, uid, starred) =>
      ipcRenderer.invoke('imap:star-message', folder, uid, starred),
    moveMessage: (folder, uid, destination) =>
      ipcRenderer.invoke('imap:move-message', folder, uid, destination),
    deleteMessage: (folder, uid, permanent) =>
      ipcRenderer.invoke('imap:delete-message', folder, uid, permanent),
    markJunk: (folder, uid, isJunk) =>
      ipcRenderer.invoke('imap:mark-junk', folder, uid, isJunk),
    search: (folder, query) =>
      ipcRenderer.invoke('imap:search', folder, query),
    syncInbox: () =>
      ipcRenderer.invoke('imap:sync-inbox'),
    markAllRead: (folder) =>
      ipcRenderer.invoke('imap:mark-all-read', folder),
    emptyFolder: (folder) =>
      ipcRenderer.invoke('imap:empty-folder', folder),
    bulkSetFlag: (folder, uids, flag, add) =>
      ipcRenderer.invoke('imap:bulk-set-flag', folder, uids, flag, add),
    bulkDelete: (folder, uids) =>
      ipcRenderer.invoke('imap:bulk-delete', folder, uids),
    bulkMove: (folder, uids, destination) =>
      ipcRenderer.invoke('imap:bulk-move', folder, uids, destination)
  },

  // ── SMTP ────────────────────────────────────────────────────────────────────
  smtp: {
    send: (email, password, mailOptions) =>
      ipcRenderer.invoke('smtp:send', email, password, mailOptions)
  },

  // ── Local store ─────────────────────────────────────────────────────────────
  store: {
    searchLocal: (query) =>
      ipcRenderer.invoke('store:search-local', query),
    getCachedFolders: () =>
      ipcRenderer.invoke('store:get-cached-folders'),
    clearBodyCache: () =>
      ipcRenderer.invoke('store:clear-body-cache'),
    clearFolderCache: () =>
      ipcRenderer.invoke('store:clear-folder-cache'),
    getDbPath: () =>
      ipcRenderer.invoke('store:get-db-path'),
    openDbFolder: () =>
      ipcRenderer.invoke('store:open-db-folder'),
    resetAllData: () =>
      ipcRenderer.invoke('store:reset-all-data'),
    getViewerData: (id) =>
      ipcRenderer.invoke('store:get-viewer-data', id)
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (updates) => ipcRenderer.invoke('settings:save', updates)
  },

  // ── Window controls ─────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    openMessage: (msg) => ipcRenderer.invoke('window:open-message', msg),
    openComposeInMain: (data) => ipcRenderer.invoke('window:open-compose-in-main', data)
  },

  // ── Shell ───────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  },

  // ── Push events (main → renderer) ───────────────────────────────────────────
  on: (channel, callback) => {
    const allowed = ['imap:new-mail', 'imap:connection-status', 'imap:sync-complete', 'open-compose']
    if (!allowed.includes(channel)) return
    const sub = (_event, ...args) => callback(...args)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback)
  }
})
