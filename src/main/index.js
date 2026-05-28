import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, dialog, protocol } from 'electron'
import { join, dirname, resolve, sep } from 'path'
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
import { syncContacts, dumpRawContacts } from './carddav/client.js'
import { syncCalendar } from './caldav/client.js'
import { logContact, logErr } from './logger.js'

protocol.registerSchemesAsPrivileged([
  { scheme: 'kumo-local', privileges: { secure: true, stream: true, bypassCSP: true } }
])

app.setAppUserModelId('Kumo')

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

function _attachExternalLinkHandler(win) {
  const isLocal = (url) => {
    if (url.startsWith('file://')) return true
    if (url.startsWith('kumo-local://')) return true
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return true
    return false
  }

  const openUrl = (url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    } else if (url.startsWith('mailto:')) {
      const to = decodeURIComponent(url.replace(/^mailto:/i, '').split('?')[0])
      mainWindow?.webContents.send('open-compose', { mode: 'new', to })
      mainWindow?.show()
      mainWindow?.focus()
    }
  }

  // Intercept target="_blank" / window.open() from renderer and iframes
  win.webContents.setWindowOpenHandler(({ url }) => {
    openUrl(url)
    return { action: 'deny' }
  })

  // Intercept main-frame navigation (e.g. link without target navigating the whole window)
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocal(url)) {
      event.preventDefault()
      openUrl(url)
    }
  })

  // Intercept iframe navigation (e.g. link clicked inside email body iframe)
  win.webContents.on('will-frame-navigate', (event) => {
    if (!isLocal(event.url) && !event.isMainFrame) {
      event.preventDefault()
      openUrl(event.url)
    }
  })
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

  _attachExternalLinkHandler(mainWindow)

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
      const size = 32
      const buf = Buffer.alloc(size * size * 4)
      const cx = size / 2 - 0.5, cy = size / 2 - 0.5, r = size / 2 - 1.5
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          const alpha = Math.max(0, Math.min(1, r + 1 - dist)) * 255
          if (alpha > 0) {
            const idx = (y * size + x) * 4
            buf[idx] = 255; buf[idx + 1] = 59; buf[idx + 2] = 48
            buf[idx + 3] = Math.round(alpha)
          }
        }
      }
      const overlay = nativeImage.createFromBuffer(buf, { width: size, height: size })
      mainWindow.setOverlayIcon(overlay, `${count} unread`)
    } catch { /* overlay icon not supported */ }
  } else {
    try { mainWindow.setOverlayIcon(null, '') } catch { /* ignore */ }
  }
}

function _makeAvatarIcon(from) {
  const seed = from || '?'
  let hash = 5381
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 ^ seed.charCodeAt(i)) & 0xffffffff
  const h = (Math.abs(hash) % 360) / 360
  const s = 0.60, l = 0.45
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const r = Math.round(hue2rgb(h + 1 / 3) * 255)
  const g = Math.round(hue2rgb(h) * 255)
  const b = Math.round(hue2rgb(h - 1 / 3) * 255)
  const size = 64
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2 - 0.5, cy = size / 2 - 0.5, radius = size / 2 - 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const alpha = Math.max(0, Math.min(1, radius + 1 - dist)) * 255
      if (alpha > 0) {
        const idx = (y * size + x) * 4
        buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = Math.round(alpha)
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
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
      const icon = _makeAvatarIcon(from)
      const n = new Notification({
        title: from || 'New Mail',
        body: subject || '(no subject)',
        icon,
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
      await shell.openPath(dirname(p))
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('store:reset-all-data', async () => {
  try {
    const entries = [...imapClients.entries()]
    for (const [e, c] of entries) {
      await c.disconnect().catch(() => {})
      imapClients.delete(e)
    }
    unreadCounts.clear()
    await deleteCredentials().catch(() => {})
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

ipcMain.handle('store:read-local-file', async (_e, filePath) => {
  try {
    const attDir = join(app.getPath('userData'), 'attachments')
    const resolved = resolve(String(filePath))
    if (!resolved.startsWith(attDir + sep) && resolved !== attDir) {
      return { ok: false, error: 'Forbidden' }
    }
    const { readFileSync } = await import('fs')
    const buf = readFileSync(resolved)
    return { ok: true, base64: buf.toString('base64') }
  } catch (err) {
    return { ok: false, error: err.message }
  }
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
    logContact(`[contacts:sync] trovati ${contacts.length} contatti, avvio upsert...`)
    let saved = 0, failed = 0
    for (const c of contacts) {
      try {
        upsertContact({ ...c, account_email: email })
        saved++
      } catch (err) {
        failed++
        if (failed <= 3) logErr(`[contacts:sync] upsert fallito per "${c.display_name}" (uid=${c.id}): ${err.message}`)
      }
    }
    logContact(`[contacts:sync] completato: ${saved} salvati, ${failed} falliti`)
    return { ok: true, count: saved }
  } catch (err) {
    logErr(`[contacts:sync] errore generale: ${err.message}`)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('contacts:list', async (_e, email) => {
  try {
    const contacts = getContacts(email)
    logContact(`[contacts:list] restituiti ${contacts.length} contatti per ${email}`)
    return { ok: true, contacts }
  } catch (err) {
    logErr(`[contacts:list] errore: ${err.message}`)
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

ipcMain.handle('contacts:dump-raw', async (_e, email, password) => {
  logContact(`[dump-raw] avvio per ${email}`)
  try {
    logContact('[dump-raw] chiamata dumpRawContacts...')
    const raw = await dumpRawContacts(email, password)
    logContact(`[dump-raw] ricevuti ${raw.length} caratteri, apro save dialog`)
    const result = await dialog.showSaveDialog({
      defaultPath: `carddav-raw-${Date.now()}.txt`,
      filters: [{ name: 'Text files', extensions: ['txt'] }],
      buttonLabel: 'Salva dump'
    })
    if (result.canceled || !result.filePath) {
      logContact('[dump-raw] dialog annullato')
      return { ok: false }
    }
    const { writeFileSync } = await import('fs')
    writeFileSync(result.filePath, raw, 'utf8')
    logContact(`[dump-raw] salvato in ${result.filePath}`)
    return { ok: true, filePath: result.filePath }
  } catch (err) {
    logErr(`[dump-raw] errore: ${err.message}`)
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
        color: '#f5f5f7',
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

    _attachExternalLinkHandler(viewerWindow)
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

ipcMain.handle('window:open-compose', async (_e, data) => {
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    viewerDataStore.set(id, data)

    const composeWindow = new BrowserWindow({
      width: 740,
      height: 640,
      minWidth: 520,
      minHeight: 480,
      frame: false,
      backgroundColor: '#f5f5f7',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f5f5f7',
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
      composeWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?compose=1&cid=${id}`)
    } else {
      composeWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { compose: '1', cid: id }
      })
    }

    _attachExternalLinkHandler(composeWindow)
    composeWindow.once('ready-to-show', () => composeWindow.show())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('shell:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
})

ipcMain.handle('shell:open-path', (_e, filePath) => {
  return shell.openPath(filePath)
})

// ── Dialog ────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:save-file', async (_e, sourcePath, filename) => {
  const result = await dialog.showSaveDialog({
    defaultPath: filename,
    buttonLabel: 'Salva'
  })
  if (result.canceled || !result.filePath) return { ok: false }
  try {
    const { copyFileSync } = await import('fs')
    copyFileSync(sourcePath, result.filePath)
    return { ok: true, filePath: result.filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

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

    const { mkdirSync, existsSync } = await import('fs')
    const attDir = join(app.getPath('userData'), 'attachments')
    mkdirSync(attDir, { recursive: true })
    const safePartId = String(partId).replace(/[^0-9.]/g, '_')
    const safeName = filename.replace(/[^a-z0-9._-]/gi, '_')
    const dest = join(attDir, `${uid}_${safePartId}_${safeName}`)
    if (!resolve(dest).startsWith(attDir + sep)) return { ok: false, error: 'Forbidden' }

    // Return cached file immediately without hitting IMAP
    if (existsSync(dest)) return { ok: true, filePath: dest }

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

const KUMO_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp'
}

app.whenReady().then(async () => {
  protocol.handle('kumo-local', async (request) => {
    try {
      let filePath = decodeURIComponent(new URL(request.url).pathname)
      if (filePath.startsWith('/')) filePath = filePath.slice(1)
      filePath = filePath.replace(/\//g, '\\')
      const { readFile } = await import('fs/promises')
      const data = await readFile(filePath)
      const ext = (filePath.split('.').pop() || '').toLowerCase()
      const mimeType = KUMO_MIME[ext] || 'application/octet-stream'
      return new Response(data, { headers: { 'content-type': mimeType } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })

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
