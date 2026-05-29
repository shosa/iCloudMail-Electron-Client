import { autoUpdater } from 'electron-updater'
import { ipcMain } from 'electron'

let _sender = null

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

autoUpdater.on('checking-for-update', () => {
  _sender?.send('updater:status', { event: 'checking' })
})

autoUpdater.on('update-available', (info) => {
  _sender?.send('updater:status', { event: 'available', version: info.version, releaseNotes: info.releaseNotes })
})

autoUpdater.on('update-not-available', () => {
  _sender?.send('updater:status', { event: 'not-available' })
})

autoUpdater.on('download-progress', (progress) => {
  _sender?.send('updater:status', { event: 'progress', percent: Math.round(progress.percent) })
})

autoUpdater.on('update-downloaded', (info) => {
  _sender?.send('updater:status', { event: 'downloaded', version: info.version })
})

autoUpdater.on('error', (err) => {
  _sender?.send('updater:status', { event: 'error', message: err.message })
})

export function initUpdater(mainWindow) {
  _sender = mainWindow.webContents

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // Check for updates 10 seconds after startup (only in production)
  if (!process.env.ELECTRON_RENDERER_URL) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 10_000)
  }
}
