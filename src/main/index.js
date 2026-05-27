import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell } from 'electron'
import { join } from 'path'
import { initDB, closeDB, searchMessages, getSettings, saveSetting, getFolders, clearBodyCache, clearFolderCache, getDbPath, resetAllData } from './store/db.js'
import { saveCredentials, getCredentials, deleteCredentials } from './auth/index.js'
import { ImapClient } from './imap/client.js'
import { sendEmail } from './smtp/index.js'

let mainWindow = null
let tray = null
let imapClient = null
let unreadCount = 0
const viewerDataStore = new Map()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#f5f5f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: 'rgba(240,240,248,0)',
      symbolColor: '#333333',
      height: 32
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    },
    show: false,
    icon: join(process.resourcesPath || __dirname, '../../resources/icon.ico')
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function createTray() {
  const iconPath = join(process.resourcesPath || __dirname, '../../resources/tray-icon.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('empty icon')
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  updateTrayMenu()
  tray.setToolTip('iCloud Mail')

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function updateTrayMenu() {
  if (!tray) return
  const badge = unreadCount > 0 ? ` (${unreadCount})` : ''
  tray.setToolTip(`iCloud Mail${badge}`)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: unreadCount > 0 ? `Open — ${unreadCount} unread` : 'Open iCloud Mail',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    {
      label: 'Check Mail',
      click: () => {
        imapClient?.syncInbox()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray = null
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
}

function showNewMailNotification(subject, from) {
  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'New Mail',
      body: `From: ${from}\n${subject}`,
      icon: join(process.resourcesPath || __dirname, '../../resources/icon.ico'),
      silent: false
    })
    n.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    n.show()
  }
}

// ── Auth IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('auth:save-credentials', async (_e, email, password) => {
  try {
    await saveCredentials(email, password)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('auth:get-credentials', async () => {
  try {
    const creds = await getCredentials()
    return { ok: true, creds }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('auth:delete-credentials', async () => {
  try {
    await deleteCredentials()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── IMAP IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('imap:connect', async (_e, email, password) => {
  try {
    if (imapClient) await imapClient.disconnect()
    imapClient = new ImapClient(email, password)

    imapClient.on('new-mail', ({ subject, from, folder, uid }) => {
      unreadCount++
      updateTrayMenu()
      showNewMailNotification(subject, from)
      mainWindow?.webContents.send('imap:new-mail', { subject, from, folder, uid })
    })

    imapClient.on('connection-status', (status) => {
      mainWindow?.webContents.send('imap:connection-status', status)
    })

    imapClient.on('unread-count', (count) => {
      unreadCount = count
      updateTrayMenu()
    })

    await imapClient.connect()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:disconnect', async () => {
  try {
    await imapClient?.disconnect()
    imapClient = null
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:get-folders', async () => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const folders = await imapClient.getFolders()
    return { ok: true, folders }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:fetch-messages', async (_e, folder, page, pageSize) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const result = await imapClient.fetchMessages(folder, page || 1, pageSize || 50)
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:fetch-body', async (_e, folder, uid) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const body = await imapClient.fetchBody(folder, uid)
    return { ok: true, body }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:mark-read', async (_e, folder, uid, read) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.setFlag(folder, uid, '\\Seen', read)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:star-message', async (_e, folder, uid, starred) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.setFlag(folder, uid, '\\Flagged', starred)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:move-message', async (_e, folder, uid, destination) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.moveMessage(folder, uid, destination)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:delete-message', async (_e, folder, uid, permanent) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.deleteMessage(folder, uid, permanent)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:mark-junk', async (_e, folder, uid, isJunk) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.markJunk(folder, uid, isJunk)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:search', async (_e, folder, query) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const results = await imapClient.search(folder, query)
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:sync-inbox', async () => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.syncInbox()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:mark-all-read', async (_e, folder) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.markAllRead(folder)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:empty-folder', async (_e, folder) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.emptyFolder(folder)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:bulk-set-flag', async (_e, folder, uids, flag, add) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.bulkSetFlag(folder, uids, flag, add)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:bulk-delete', async (_e, folder, uids) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.bulkDelete(folder, uids)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:bulk-move', async (_e, folder, uids, destination) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.bulkMove(folder, uids, destination)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── SMTP IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('smtp:send', async (_e, email, password, mailOptions) => {
  try {
    await sendEmail(email, password, mailOptions)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Store IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('store:search-local', async (_e, query) => {
  try {
    const results = searchMessages(query)
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:get-cached-folders', async () => {
  try {
    const folders = getFolders()
    return { ok: true, folders }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:clear-body-cache', async () => {
  try {
    clearBodyCache()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:clear-folder-cache', async () => {
  try {
    clearFolderCache()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:get-db-path', async () => {
  return { ok: true, path: getDbPath() }
})

ipcMain.handle('store:open-db-folder', async () => {
  try {
    const p = getDbPath()
    if (p) {
      const { dirname } = await import('path')
      await shell.openPath(dirname(p))
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:reset-all-data', async () => {
  try {
    resetAllData()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:get-viewer-data', async (_e, id) => {
  const data = viewerDataStore.get(id)
  if (data) viewerDataStore.delete(id)
  return { ok: true, data: data || null }
})

// ── Settings IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', async () => {
  try {
    const settings = getSettings()
    return { ok: true, settings }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('settings:save', async (_e, updates) => {
  try {
    for (const [key, value] of Object.entries(updates)) saveSetting(key, value)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Window controls ───────────────────────────────────────────────────────────

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.hide())

ipcMain.handle('window:open-message', async (_e, msg) => {
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    viewerDataStore.set(id, msg)

    const viewerWindow = new BrowserWindow({
      width: 820,
      height: 720,
      minWidth: 580,
      minHeight: 480,
      frame: false,
      backgroundColor: '#f5f5f7',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: 'rgba(240,240,248,0)',
        symbolColor: '#333333',
        height: 32
      },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      },
      show: false
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      viewerWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?viewer=1&vid=${id}`)
    } else {
      viewerWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { viewer: '1', vid: id }
      })
    }

    viewerWindow.once('ready-to-show', () => viewerWindow.show())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('window:open-compose-in-main', (_e, data) => {
  mainWindow?.webContents.send('open-compose', data)
  mainWindow?.show()
  mainWindow?.focus()
  return { ok: true }
})

ipcMain.handle('shell:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await initDB()
  createWindow()
  createTray()

  const creds = await getCredentials()
  if (creds) {
    imapClient = new ImapClient(creds.email, creds.password)

    imapClient.on('new-mail', ({ subject, from, folder, uid }) => {
      unreadCount++
      updateTrayMenu()
      showNewMailNotification(subject, from)
      mainWindow?.webContents.send('imap:new-mail', { subject, from, folder, uid })
    })

    imapClient.on('connection-status', (status) => {
      mainWindow?.webContents.send('imap:connection-status', status)
    })

    imapClient.on('unread-count', (count) => {
      unreadCount = count
      updateTrayMenu()
    })

    try {
      await imapClient.connect()
    } catch (err) {
      console.error('Auto-connect failed:', err.message)
    }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await imapClient?.disconnect()
  closeDB()
})
