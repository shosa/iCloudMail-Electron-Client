import { ipcMain } from 'electron'

let _sender = null
let _autoUpdater = null
let _registered = false

async function getAutoUpdater() {
  if (_autoUpdater) return _autoUpdater
  if (process.env.ELECTRON_RENDERER_URL) return null

  const { autoUpdater } = await import('electron-updater')
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

  _autoUpdater = autoUpdater
  return _autoUpdater
}

export function initUpdater(mainWindow) {
  _sender = mainWindow.webContents

  if (!_registered) {
    ipcMain.handle('updater:check', async () => {
      try {
        const autoUpdater = await getAutoUpdater()
        if (!autoUpdater) return { ok: false, error: 'Updater disabled in development' }
        await autoUpdater.checkForUpdates()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })

    ipcMain.handle('updater:download', async () => {
      try {
        const autoUpdater = await getAutoUpdater()
        if (!autoUpdater) return { ok: false, error: 'Updater disabled in development' }
        await autoUpdater.downloadUpdate()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })

    ipcMain.handle('updater:install', async () => {
      const autoUpdater = await getAutoUpdater()
      autoUpdater?.quitAndInstall(false, true)
    })

    _registered = true
  }

  if (!process.env.ELECTRON_RENDERER_URL) {
    setTimeout(async () => {
      const autoUpdater = await getAutoUpdater()
      autoUpdater?.checkForUpdates().catch(() => {})
    }, 10_000)
  }
}
