import React, { useState } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import { IconClose, IconSignOut, IconLanguage, IconClearCache } from './Icons'

function Toggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle__track" />
      <span className="toggle__thumb" />
    </label>
  )
}

export default function Settings() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const s = state.settings

  const [local, setLocal] = useState({
    blockRemoteImages: s.blockRemoteImages ?? true,
    notificationsEnabled: s.notificationsEnabled ?? true,
    syncMode: s.syncMode || 'idle',
    syncInterval: s.syncInterval || 5,
    signature: s.signature || '',
    theme: s.theme || 'light',
    language: s.language || 'en'
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)
  const [clearingFolders, setClearingFolders] = useState(false)
  const [foldersCleared, setFoldersCleared] = useState(false)
  const [dbPath, setDbPath] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  function update(key, value) {
    setLocal(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const result = await window.api.settings.save(local)
    if (result.ok) {
      dispatch({ type: 'UPDATE_SETTINGS', payload: local })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  function handleClose() {
    dispatch({ type: 'CLOSE_SETTINGS' })
  }

  async function handleSignOut() {
    await window.api.auth.deleteCredentials()
    await window.api.imap.disconnect()
    dispatch({ type: 'SET_UNAUTHENTICATED' })
    handleClose()
  }

  async function handleClearCache() {
    setClearingCache(true)
    await window.api.store.clearBodyCache()
    setClearingCache(false)
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2500)
  }

  async function handleClearFolderCache() {
    setClearingFolders(true)
    await window.api.store.clearFolderCache()
    setClearingFolders(false)
    setFoldersCleared(true)
    setTimeout(() => setFoldersCleared(false), 2500)
  }

  async function handleResetAllData() {
    if (!confirmReset) { setConfirmReset(true); return }
    setResetting(true)
    await window.api.store.resetAllData()
    dispatch({ type: 'SET_UNAUTHENTICATED' })
    handleClose()
  }

  React.useEffect(() => {
    window.api.store.getDbPath().then(r => { if (r.ok) setDbPath(r.path || '') })
  }, [])

  return (
    <div className="settings-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="settings-panel">
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">{t('settings.title')}</h2>
          <button className="btn btn--icon" onClick={handleClose}><IconClose size={16} /></button>
        </div>

        <div className="settings-panel__body">
          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.appearance')}</div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.theme')}</div>
              </div>
              <select className="settings-select" value={local.theme} onChange={e => update('theme', e.target.value)}>
                <option value="dark">{t('settings.themeDark')}</option>
                <option value="light">{t('settings.themeLight')}</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.languageLabel')}</div>
              </div>
              <select className="settings-select" value={local.language} onChange={e => update('language', e.target.value)}>
                <option value="en">English</option>
                <option value="it">Italiano</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="jp">日本語</option>
                <option value="es">Español</option>
                <option value="ru">Русский</option>
                <option value="cn">中文（简体）</option>
              </select>
            </div>
          </div>

          {/* Privacy */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.privacy')}</div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.blockImages')}</div>
                <div className="settings-row__desc">{t('settings.blockImagesDesc')}</div>
              </div>
              <Toggle checked={local.blockRemoteImages} onChange={v => update('blockRemoteImages', v)} />
            </div>
          </div>

          {/* Notifications */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.notifications')}</div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.notificationsEnabled')}</div>
                <div className="settings-row__desc">{t('settings.notificationsDesc')}</div>
              </div>
              <Toggle checked={local.notificationsEnabled} onChange={v => update('notificationsEnabled', v)} />
            </div>
          </div>

          {/* Sync */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.sync')}</div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.syncMode')}</div>
                <div className="settings-row__desc">{t('settings.syncModeDesc')}</div>
              </div>
              <select className="settings-select" value={local.syncMode} onChange={e => update('syncMode', e.target.value)}>
                <option value="idle">{t('settings.syncPush')}</option>
                <option value="interval">{t('settings.syncInterval')}</option>
              </select>
            </div>

            {local.syncMode === 'interval' && (
              <div className="settings-row">
                <div className="settings-row__info">
                  <div className="settings-row__label">{t('settings.checkEvery')}</div>
                </div>
                <select className="settings-select" value={local.syncInterval} onChange={e => update('syncInterval', Number(e.target.value))}>
                  {[1, 2, 5, 10, 15, 30, 60].map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? t('settings.minute') : t('settings.minutes')}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Signature */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.signature')}</div>
            <textarea
              className="signature-editor"
              placeholder={t('settings.signaturePlaceholder')}
              value={local.signature}
              onChange={e => update('signature', e.target.value)}
              rows={4}
            />
          </div>

          {/* Data */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.data')}</div>

            {dbPath && (
              <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-row__info">
                  <div className="settings-row__label">{t('settings.dataLocation')}</div>
                  <div className="settings-row__desc" style={{ wordBreak: 'break-all', userSelect: 'text' }}>{dbPath}</div>
                </div>
                <button
                  className="btn btn--ghost"
                  onClick={() => window.api.store.openDbFolder()}
                  style={{ flexShrink: 0 }}
                >{t('settings.openFolder')}</button>
              </div>
            )}

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.clearCache')}</div>
                <div className="settings-row__desc">{t('settings.clearCacheDesc')}</div>
              </div>
              <button className="btn btn--ghost" onClick={handleClearCache} disabled={clearingCache} style={{ flexShrink: 0 }}>
                {clearingCache ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : cacheCleared ? t('settings.clearCacheSuccess')
                  : <><IconClearCache size={15} /> {t('settings.clearCache')}</>}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.clearFolderCache')}</div>
                <div className="settings-row__desc">{t('settings.clearFolderCacheDesc')}</div>
              </div>
              <button className="btn btn--ghost" onClick={handleClearFolderCache} disabled={clearingFolders} style={{ flexShrink: 0 }}>
                {clearingFolders ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : foldersCleared ? t('settings.clearCacheSuccess')
                  : <><IconClearCache size={15} /> {t('settings.clearFolderCache')}</>}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label" style={{ color: 'var(--color-error)' }}>{t('settings.resetData')}</div>
                <div className="settings-row__desc">{t('settings.resetDataDesc')}</div>
              </div>
              <button
                className={`btn ${confirmReset ? 'btn--danger' : 'btn--ghost'}`}
                onClick={handleResetAllData}
                disabled={resetting}
                style={{ flexShrink: 0 }}
                onBlur={() => setConfirmReset(false)}
              >
                {resetting ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : confirmReset ? t('settings.resetDataConfirm')
                  : t('settings.resetData')}
              </button>
            </div>
          </div>

          {/* Account */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.account')}</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-3)' }}>
              {t('settings.signedInAs')} <strong>{state.auth.email}</strong>
            </div>
            <button
              className="btn btn--danger"
              onClick={handleSignOut}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <IconSignOut size={15} /> {t('settings.signOut')}
            </button>
          </div>
        </div>

        <div className="settings-panel__footer">
          {saved && (
            <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)', marginRight: 'auto' }}>
              {t('settings.saved')}
            </span>
          )}
          <button className="btn btn--ghost" onClick={handleClose}>{t('settings.cancel')}</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving
              ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {t('settings.saving')}</>
              : t('settings.save')
            }
          </button>
        </div>
      </div>
    </div>
  )
}
