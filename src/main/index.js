import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, dialog } from 'electron'
import { join } from 'path'
import {
  initDB, closeDB, searchMessages, getSettings, saveSetting,
  getFolders, clearBodyCache, clearFolderCache, getDbPath, resetAllData,
  getAccounts, upsertAccount, deleteAccount,
  getDrafts, upsertDraft, deleteDraft,
  getSyncState,
  getAttachmentsMeta, markAttachmentDownloaded,
  upsertContact, getContacts, searchContacts, deleteContacts,
  upsertEvent, getEvents, deleteEvents
} from './store/db.js'
import { saveCredentials, getCredentials, deleteCredentials, listStoredEmails } from './auth/index.js'
import { ImapClient } from './imap/client.js'
import { sendEmail } from './smtp/index.js'
import { syncContacts } from './carddav/client.js'
import { syncCalendar } from './caldav/client.js'

let mainWindow = null
let tray = null
const imapClients = new Map()   // email → ImapClient
const unreadCounts = new Map()  // email → number
const viewerDataStore = new Map()

function getResourcePath(filename) {
  if (process.env.ELECTRON_RENDERER_URL) {
    // dev: app.getAppPath() is the project root
    return join(app.getAppPath(), 'resources', filename)
  }
  return join(process.resourcesPath, filename)
}

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
    icon: getResourcePath('icon.ico')
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
  const iconPath = getResourcePath('tray-icon.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('empty icon')
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  updateTrayMenu()
  tray.setToolTip('Kumo')

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

const TRAY_STRINGS = {
  en: { open: 'Open Kumo', openUnread: n => `Open — ${n} unread`, checkMail: 'Check Mail', quit: 'Quit' },
  it: { open: 'Apri Kumo', openUnread: n => `Apri — ${n} non letti`, checkMail: 'Controlla posta', quit: 'Esci' },
  fr: { open: 'Ouvrir Kumo', openUnread: n => `Ouvrir — ${n} non lus`, checkMail: 'Vérifier le courrier', quit: 'Quitter' },
  de: { open: 'Kumo öffnen', openUnread: n => `Öffnen — ${n} ungelesen`, checkMail: 'E-Mails abrufen', quit: 'Beenden' },
  es: { open: 'Abrir Kumo', openUnread: n => `Abrir — ${n} sin leer`, checkMail: 'Revisar correo', quit: 'Salir' },
  ru: { open: 'Открыть Kumo', openUnread: n => `Открыть — ${n} непрочитанных`, checkMail: 'Проверить почту', quit: 'Выйти' },
  jp: { open: 'Kumoを開く', openUnread: n => `開く — ${n}件の未読`, checkMail: 'メールを確認', quit: '終了' },
  cn: { open: '打开 Kumo', openUnread: n => `打开 — ${n} 封未读`, checkMail: '检查邮件', quit: '退出' }
}

function updateTrayMenu() {
  if (!tray) return
  const totalUnread = [...unreadCounts.values()].reduce((a, b) => a + b, 0)
  const badge = totalUnread > 0 ? ` (${totalUnread})` : ''
  tray.setToolTip(`Kumo${badge}`)

  let lang = 'en'
  try { lang = getSettings().language || 'en' } catch { /* use default */ }
  const s = TRAY_STRINGS[lang] || TRAY_STRINGS.en

  const contextMenu = Menu.buildFromTemplate([
    {
      label: totalUnread > 0 ? s.openUnread(totalUnread) : s.open,
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    {
      label: s.checkMail,
      click: () => {
        for (const client of imapClients.values()) client.syncInbox?.()
      }
    },
    { type: 'separator' },
    {
      label: s.quit,
      click: () => {
        tray = null
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
  updateTaskbarBadge(totalUnread)
}

function updateTaskbarBadge(count) {
  if (!mainWindow) return
  if (count > 0) {
    try {
      const size = 16
      const canvas = Buffer.alloc(size * size * 4)
      const cx = size / 2, cy = size / 2, r = size / 2 - 1
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          const idx = (y * size + x) * 4
          if (dist <= r) {
            canvas[idx]     = 255
            canvas[idx + 1] = 69
            canvas[idx + 2] = 58
            canvas[idx + 3] = 255
          }
        }
      }
      const overlay = nativeImage.createFromBuffer(canvas, { width: size, height: size })
      mainWindow.setOverlayIcon(overlay, `${count} unread`)
    } catch { /* overlay icon not supported */ }
  } else {
    try { mainWindow.setOverlayIcon(null, '') } catch { /* ignore */ }
  }
}

function showNewMailNotification(subject, from, folder) {
  try {
    const settings = getSettings()
    if (!settings.notificationsEnabled) return
    const notifyFolders = settings.notifyFolders || ['INBOX']
    if (!notifyFolders.includes(folder)) return
  } catch { /* proceed anyway if settings unavailable */ }

  if (Notification.isSupported()) {
    try {
      const n = new Notification({
        title: 'New Mail',
        body: `From: ${from}\n${subject}`,
        silent: false
      })
      n.on('click', () => {
        mainWindow?.show()
        mainWindow?.focus()
        mainWindow?.webContents.send('imap:notification-click', { folder })
      })
      n.show()
    } catch { /* Notification construction failed */ }
  }
}

function _attachClientEvents(email, client) {
  if (client._listenersAttached) return
  client._listenersAttached = true
  client.on('new-mail', ({ subject, from, folder, uid }) => {
    const cur = unreadCounts.get(email) || 0
    unreadCounts.set(email, cur + 1)
    updateTrayMenu()
    showNewMailNotification(subject, from, folder)
    mainWindow?.webContents.send('imap:new-mail', { subject, from, folder, uid, account: email })
  })
  client.on('connection-status', (status) => {
    mainWindow?.webContents.send('imap:connection-status', { status, account: email })
  })
  client.on('unread-count', (count) => {
    unreadCounts.set(email, count)
    updateTrayMenu()
  })
  client.on('sync-complete', ({ folder, newCount, removedCount }) => {
    mainWindow?.webContents.send('imap:sync-complete', { folder, newCount, removedCount, account: email })
  })
  client.on('flags-updated', ({ folder, uid, flags }) => {
    mainWindow?.webContents.send('imap:flags-updated', { folder, uid, flags, account: email })
  })
}

function getClient(email) {
  if (email) return imapClients.get(email) || null
  return imapClients.values().next().value || null
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
    if (!email || !password) return { ok: false, error: 'email and password required' }
    const existing = imapClients.get(email)
    if (existing) await existing.disconnect().catch(() => {})
    const client = new ImapClient(email, password)
    _attachClientEvents(email, client)
    imapClients.set(email, client)
    await client.connect()
    return { ok: true }
  } catch (err) {
    imapClients.delete(email)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:disconnect', async (_e, email) => {
  try {
    if (email) {
      const client = imapClients.get(email)
      if (client) {
        await client.disconnect().catch(() => {})
        imapClients.delete(email)
      }
    } else {
      const entries = [...imapClients.entries()]
      for (const [e, c] of entries) {
        await c.disconnect().catch(() => {})
        imapClients.delete(e)
      }
    }
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('imap:get-folders', async (_e, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const folders = await imapClient.getFolders()
    return { ok: true, folders }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:fetch-messages', async (_e, folder, page, pageSize, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const result = await imapClient.fetchMessages(folder, page || 1, pageSize || 50)
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:fetch-body', async (_e, folder, uid, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const body = await imapClient.fetchBody(folder, uid)
    return { ok: true, body }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:mark-read', async (_e, folder, uid, read, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.setFlag(folder, uid, '\\Seen', read)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:star-message', async (_e, folder, uid, starred, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.setFlag(folder, uid, '\\Flagged', starred)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:move-message', async (_e, folder, uid, destination, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.moveMessage(folder, uid, destination)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:delete-message', async (_e, folder, uid, permanent, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.deleteMessage(folder, uid, permanent)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:mark-junk', async (_e, folder, uid, isJunk, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.markJunk(folder, uid, isJunk)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:search', async (_e, folder, query, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    const results = await imapClient.search(folder, query)
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:sync-inbox', async (_e, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.syncInbox()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:sync-folder', async (_e, folder, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient._syncFolder(folder, false)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:mark-all-read', async (_e, folder, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.markAllRead(folder)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:empty-folder', async (_e, folder, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.emptyFolder(folder)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:bulk-set-flag', async (_e, folder, uids, flag, add, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.bulkSetFlag(folder, uids, flag, add)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:bulk-delete', async (_e, folder, uids, email) => {
  const imapClient = getClient(email)
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient.bulkDelete(folder, uids)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:bulk-move', async (_e, folder, uids, destination, email) => {
  const imapClient = getClient(email)
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

ipcMain.handle('store:get-sync-state', async (_e, folder) => {
  try {
    const creds = await getCredentials()
    if (!creds) return { ok: true, state: null }
    const state = getSyncState(creds.email, folder)
    return { ok: true, state }
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
    updateTrayMenu()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Accounts IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('accounts:list', async () => {
  try { return { ok: true, accounts: getAccounts() } }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('accounts:save', async (_e, account) => {
  try { upsertAccount(account); return { ok: true } }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('accounts:delete', async (_e, email) => {
  try { deleteAccount(email); return { ok: true } }
  catch (err) { return { ok: false, error: err.message } }
})

// ── Drafts IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('drafts:list', async (_e, accountEmail) => {
  try { return { ok: true, drafts: getDrafts(accountEmail) } }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('drafts:save', async (_e, draft) => {
  try {
    const id = upsertDraft(draft)
    return { ok: true, id }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('drafts:delete', async (_e, id) => {
  try { deleteDraft(id); return { ok: true } }
  catch (err) { return { ok: false, error: err.message } }
})

// ── Contacts IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('contacts:sync', async (_e, email, password) => {
  try {
    const contacts = await syncContacts(email, password)
    for (const c of contacts) upsertContact({ ...c, account_email: email })
    return { ok: true, count: contacts.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('contacts:list', async (_e, email) => {
  try {
    const contacts = getContacts(email)
    return { ok: true, contacts }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('contacts:search', async (_e, query, email) => {
  try {
    const contacts = searchContacts(query, email)
    return { ok: true, contacts }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('contacts:clear', async (_e, email) => {
  try {
    deleteContacts(email)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Calendar IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('calendar:sync', async (_e, email, password) => {
  try {
    const events = await syncCalendar(email, password)
    for (const ev of events) upsertEvent({ ...ev, account_email: email })
    return { ok: true, count: events.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('calendar:events', async (_e, email, fromTs, toTs) => {
  try {
    const events = getEvents(email, fromTs, toTs)
    return { ok: true, events }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('calendar:clear', async (_e, email) => {
  try {
    deleteEvents(email)
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
ipcMain.handle('window:set-badge', (_e, count) => {
  const n = Math.max(0, count)
  updateTaskbarBadge(n)
})

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

ipcMain.handle('shell:open-path', (_e, filePath) => {
  return shell.openPath(filePath)
})

// ── Dialog ────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Attach Files'
  })
  if (result.canceled) return { ok: true, files: [] }
  const { statSync } = await import('fs')
  const { basename } = await import('path')
  const files = result.filePaths.map(p => {
    let size = 0
    try { size = statSync(p).size } catch { /* ignore */ }
    return { path: p, name: basename(p), size }
  })
  return { ok: true, files }
})

ipcMain.handle('imap:download-attachment', async (_e, folder, uid, partId, filename, email) => {
  try {
    const client = getClient(email)
    if (!client) return { ok: false, error: 'Not connected' }

    const { join } = await import('path')
    const { mkdirSync } = await import('fs')
    const attDir = join(app.getPath('userData'), 'attachments')
    mkdirSync(attDir, { recursive: true })
    const safeName = filename.replace(/[^a-z0-9._-]/gi, '_')
    const dest = join(attDir, `${uid}_${partId}_${safeName}`)

    const { downloaded, filePath } = await client.downloadAttachment(folder, uid, partId, dest)
    if (downloaded) {
      const metas = getAttachmentsMeta(uid, folder)
      const meta = metas.find(m => m.part_id === partId && m.filename === filename)
      if (meta) markAttachmentDownloaded(meta.id, filePath)
    }
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('imap:get-attachment-meta', async (_e, uid, folder) => {
  try {
    const metas = getAttachmentsMeta(uid, folder)
    return { ok: true, metas }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await initDB()
  createWindow()
  createTray()

  let storedEmails = []
  try {
    storedEmails = await listStoredEmails()
  } catch (err) {
    console.error('Could not load stored accounts:', err.message)
  }
  for (const email of storedEmails) {
    const creds = await getCredentials(email)
    if (!creds) continue
    const client = new ImapClient(creds.email, creds.password)
    _attachClientEvents(creds.email, client)
    imapClients.set(creds.email, client)
    client.connect().catch(err => {
      console.error(`Auto-connect failed for ${creds.email}:`, err.message)
      imapClients.delete(creds.email)
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  for (const client of imapClients.values()) {
    await client.disconnect().catch(() => {})
  }
  closeDB()
})
