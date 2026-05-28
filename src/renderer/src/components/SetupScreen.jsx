import React, { useState } from 'react'
import { useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import logoUrl from '../assets/icon.png'

export default function SetupScreen() {
  const dispatch = useAppDispatch()
  const t = useTranslation()
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
      <div className="setup-card">
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
      </div>
    </div>
  )
}
