import React, { useState } from 'react'
import { useAppDispatch, useAppState } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import logoUrl from '../assets/icon.png'

const SETUP_LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'es-ES', label: 'Español' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'nl-NL', label: 'Nederlands' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', label: '中文（简体）' },
]

export default function SetupScreen() {
  const dispatch = useAppDispatch()
  const state = useAppState()
  const t = useTranslation()

  function handleLanguageChange(e) {
    const lang = e.target.value
    dispatch({ type: 'UPDATE_SETTINGS', payload: { language: lang } })
    window.api.settings.save({ language: lang })
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setLoading(true)
    setError(null)

    try {
      const connectResult = await window.api.imap.connect(email.trim(), password.trim())
      if (!connectResult.ok) {
        setError(t('setup.error.connection'))
        setLoading(false)
        return
      }

      const saveResult = await window.api.auth.saveCredentials(email.trim(), password.trim())
      if (!saveResult.ok) {
        setError(t('setup.error.save'))
        setLoading(false)
        return
      }

      dispatch({ type: 'SET_AUTHENTICATED', payload: email.trim() })
    } catch {
      setError(t('setup.error.connection'))
      setLoading(false)
    }
  }

  function openAppleHelp() {
    window.api.shell.openExternal('https://support.apple.com/HT204397')
  }

  return (
    <div className="setup-screen">
      <div className="setup-card" style={{ position: 'relative' }}>
        <img src={logoUrl} alt="Kumo" className="setup-card__logo" />

        <h1 className="setup-card__title">Kumo</h1>
        <p className="setup-card__subtitle">{t('setup.subtitle')}</p>

        <form className="setup-form" onSubmit={handleSubmit}>
          <div>
            <label className="input-label" htmlFor="email">{t('setup.emailLabel')}</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@icloud.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="input-label" htmlFor="app-password">{t('setup.passwordLabel')}</label>
            <input
              id="app-password"
              type="password"
              className="input"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          {error && <div className="setup-error">{error}</div>}

          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading || !email.trim() || !password.trim()}
            style={{ width: '100%', padding: 'var(--sp-3) var(--sp-4)', justifyContent: 'center' }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16 }} />
                {t('setup.connecting')}
              </>
            ) : (
              t('setup.signIn')
            )}
          </button>

          <p className="setup-help">
            {t('setup.helpText')}{' '}
            <button
              type="button"
              onClick={openAppleHelp}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', padding: 0 }}
            >
              {t('setup.helpLink')}
            </button>
          </p>
        </form>

        <select
          value={state.settings.language || 'en-US'}
          onChange={handleLanguageChange}
          style={{
            position: 'absolute', bottom: 'var(--sp-4)', right: 'var(--sp-4)',
            background: 'none', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)',
            fontSize: 'var(--text-xs)', padding: '2px var(--sp-2)',
            cursor: 'pointer', appearance: 'none', outline: 'none'
          }}
        >
          {SETUP_LANGUAGES.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
