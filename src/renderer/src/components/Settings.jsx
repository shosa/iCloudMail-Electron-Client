import React, { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import { IconClose, IconSignOut, IconLanguage, IconClearCache, IconTrash, IconCheck, IconFolderOpen, IconBold, IconItalic, IconUnderlineF } from './Icons'

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
    language: s.language || 'en',
    displayDensity: s.displayDensity || 'comfortable'
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)
  const [clearingFolders, setClearingFolders] = useState(false)
  const [foldersCleared, setFoldersCleared] = useState(false)
  const [clearingContacts, setClearingContacts] = useState(false)
  const [contactsCleared, setContactsCleared] = useState(false)
  const [clearingCalendar, setClearingCalendar] = useState(false)
  const [calendarCleared, setCalendarCleared] = useState(false)
  const [dbPath, setDbPath] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const sigEditor = useEditor({
    extensions: [StarterKit, Underline],
    content: local.signature || '',
    onUpdate: ({ editor }) => {
      setLocal(s => ({ ...s, signature: editor.getHTML() }))
    }
  })


  function handleDensityChange(density) {
    setLocal(s => ({ ...s, displayDensity: density }))
    document.documentElement.style.setProperty('--density-scale', {
      compact: '0.85', comfortable: '1', spacious: '1.15'
    }[density] || '1')
  }

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

  async function handleClearContacts() {
    setClearingContacts(true)
    await window.api.contacts.clear(state.auth.email)
    dispatch({ type: 'SET_CONTACTS', payload: [] })
    setClearingContacts(false)
    setContactsCleared(true)
    setTimeout(() => setContactsCleared(false), 2500)
  }

  async function handleClearCalendar() {
    setClearingCalendar(true)
    await window.api.calendar.clear(state.auth.email)
    dispatch({ type: 'SET_CALENDAR_EVENTS', payload: [] })
    setClearingCalendar(false)
    setCalendarCleared(true)
    setTimeout(() => setCalendarCleared(false), 2500)
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
                <div className="settings-row__label">{t('settings.languageLabel')}</div>
              </div>
              <select className="settings-select" value={local.language} onChange={e => update('language', e.target.value)}>
                <option value="en-US">English</option>
                <option value="it-IT">Italiano</option>
                <option value="fr-FR">Français</option>
                <option value="de-DE">Deutsch</option>
                <option value="es-ES">Español</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="nl-NL">Nederlands</option>
                <option value="ru-RU">Русский</option>
                <option value="tr-TR">Türkçe</option>
                <option value="ko-KR">한국어</option>
                <option value="ja-JP">日本語</option>
                <option value="zh-CN">中文（简体）</option>
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
            <div className="settings-section__label">{t('settings.signatureLabel')}</div>
            <div className="tiptap-editor settings-signature-editor">
              {sigEditor && (
                <div className="settings-sig-toolbar">
                  <button
                    className={`settings-sig-toolbar__btn${sigEditor.isActive('bold') ? ' is-active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); sigEditor.chain().focus().toggleBold().run() }}
                    title="Bold"
                  ><IconBold size={16} /></button>
                  <button
                    className={`settings-sig-toolbar__btn${sigEditor.isActive('italic') ? ' is-active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); sigEditor.chain().focus().toggleItalic().run() }}
                    title="Italic"
                  ><IconItalic size={16} /></button>
                  <button
                    className={`settings-sig-toolbar__btn${sigEditor.isActive('underline') ? ' is-active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); sigEditor.chain().focus().toggleUnderline().run() }}
                    title="Underline"
                  ><IconUnderlineF size={16} /></button>
                </div>
              )}
              {sigEditor && <EditorContent editor={sigEditor} />}
            </div>
          </div>

          {/* Display Density */}
          <div className="settings-section">
            <div className="settings-section__title">{t('settings.display')}</div>
            <div className="settings-section">
              <div className="settings-section__label">{t('settings.displayDensity')}</div>
              <div className="settings-radio-group">
                {['compact', 'comfortable', 'spacious'].map(d => (
                  <label key={d} className="settings-radio">
                    <input
                      type="radio"
                      name="density"
                      value={d}
                      checked={(local.displayDensity || 'comfortable') === d}
                      onChange={() => handleDensityChange(d)}
                    />
                    {t(`settings.density.${d}`)}
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section__label">{t('settings.theme')}</div>
              <div className="settings-radio-group">
                {[['light', 'settings.themeLight'], ['dark', 'settings.themeDark'], ['system', 'settings.themeSystem']].map(([themeVal, labelKey]) => (
                  <label key={themeVal} className="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value={themeVal}
                      checked={(local.theme || 'light') === themeVal}
                      onChange={() => {
                        setLocal(s => ({ ...s, theme: themeVal }))
                        dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: themeVal } })
                      }}
                    />
                    {t(labelKey)}
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section__label">{t('settings.notifications')}</div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={!!local.notificationsEnabled}
                  onChange={e => { setLocal(s => ({ ...s, notificationsEnabled: e.target.checked })); setSaved(false) }}
                />
                {t('settings.notificationsEnabled')}
              </label>
            </div>
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
                  className="btn btn--ghost btn--ghost-icon"
                  onClick={() => window.api.store.openDbFolder()}
                  title={t('settings.openFolder')}
                  style={{ flexShrink: 0 }}
                ><IconFolderOpen size={15} /></button>
              </div>
            )}

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.clearCache')}</div>
                <div className="settings-row__desc">{t('settings.clearCacheDesc')}</div>
              </div>
              <button className="btn btn--ghost btn--ghost-icon" onClick={handleClearCache} disabled={clearingCache} title={t('settings.clearCache')} style={{ flexShrink: 0 }}>
                {clearingCache ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : cacheCleared ? <IconCheck size={15} style={{ color: 'var(--color-success)' }} />
                  : <IconClearCache size={15} />}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.clearFolderCache')}</div>
                <div className="settings-row__desc">{t('settings.clearFolderCacheDesc')}</div>
              </div>
              <button className="btn btn--ghost btn--ghost-icon" onClick={handleClearFolderCache} disabled={clearingFolders} title={t('settings.clearFolderCache')} style={{ flexShrink: 0 }}>
                {clearingFolders ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : foldersCleared ? <IconCheck size={15} style={{ color: 'var(--color-success)' }} />
                  : <IconClearCache size={15} />}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.clearContacts')}</div>
                <div className="settings-row__desc">{t('settings.clearContactsDesc')}</div>
              </div>
              <button className="btn btn--ghost btn--ghost-icon" onClick={handleClearContacts} disabled={clearingContacts} title={t('settings.clearContacts')} style={{ flexShrink: 0 }}>
                {clearingContacts ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : contactsCleared ? <IconCheck size={15} style={{ color: 'var(--color-success)' }} />
                  : <IconClearCache size={15} />}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label">{t('settings.clearCalendar')}</div>
                <div className="settings-row__desc">{t('settings.clearCalendarDesc')}</div>
              </div>
              <button className="btn btn--ghost btn--ghost-icon" onClick={handleClearCalendar} disabled={clearingCalendar} title={t('settings.clearCalendar')} style={{ flexShrink: 0 }}>
                {clearingCalendar ? <span className="spinner" style={{ width: 14, height: 14 }} />
                  : calendarCleared ? <IconCheck size={15} style={{ color: 'var(--color-success)' }} />
                  : <IconClearCache size={15} />}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row__info">
                <div className="settings-row__label" style={{ color: 'var(--color-error)' }}>{t('settings.resetData')}</div>
                <div className="settings-row__desc">{t('settings.resetDataDesc')}</div>
              </div>
              <button
                className={`btn btn--ghost-icon ${confirmReset ? 'btn--danger' : 'btn--ghost'}`}
                onClick={handleResetAllData}
                disabled={resetting}
                title={confirmReset ? t('settings.resetDataConfirm') : t('settings.resetData')}
                style={{ flexShrink: 0 }}
                onBlur={() => setConfirmReset(false)}
              >
                {resetting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconTrash size={15} />}
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
