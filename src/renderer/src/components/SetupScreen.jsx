import React, { useState, useRef, useEffect } from 'react'
import { useAppDispatch, useAppState } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import logoUrl from '../assets/icon.png'

const SETUP_LANGUAGES = [
  { code: 'en-US', label: 'English',         short: 'EN' },
  { code: 'it-IT', label: 'Italiano',        short: 'IT' },
  { code: 'fr-FR', label: 'Français',        short: 'FR' },
  { code: 'de-DE', label: 'Deutsch',         short: 'DE' },
  { code: 'es-ES', label: 'Español',         short: 'ES' },
  { code: 'pt-BR', label: 'Português (BR)',  short: 'PT' },
  { code: 'nl-NL', label: 'Nederlands',      short: 'NL' },
  { code: 'ru-RU', label: 'Русский',         short: 'RU' },
  { code: 'tr-TR', label: 'Türkçe',          short: 'TR' },
  { code: 'ko-KR', label: '한국어',           short: 'KO' },
  { code: 'ja-JP', label: '日本語',           short: 'JA' },
  { code: 'zh-CN', label: '中文（简体）',     short: 'ZH' },
]

function LanguagePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = SETUP_LANGUAGES.find(l => l.code === value) || SETUP_LANGUAGES[0]

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: 'var(--glass-fill)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-full)',
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          backdropFilter: 'blur(20px)',
          transition: 'all var(--duration-fast) var(--ease-default)',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--glass-border-light)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
        </svg>
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-layer1)',
          border: '1px solid var(--glass-border-light)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(40px)',
          padding: '8px',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
          minWidth: 260,
          animation: 'scaleIn 120ms var(--ease-spring)',
          transformOrigin: 'bottom center',
          zIndex: 999,
        }}>
          {SETUP_LANGUAGES.map(l => {
            const active = l.code === value
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => { onChange(l.code); setOpen(false) }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '8px 6px',
                  background: active ? 'var(--accent-subtle)' : 'transparent',
                  border: active ? '1px solid var(--accent)' : '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all var(--duration-fast) var(--ease-default)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--glass-fill-hover)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
                  {l.short}
                </span>
                <span style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 72, textAlign: 'center' }}>
                  {l.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function SetupScreen() {
  const dispatch = useAppDispatch()
  const state = useAppState()
  const t = useTranslation()

  function handleLanguageChange(lang) {
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-4)' }}>
        <div className="setup-card">
          <img src={logoUrl} alt="Kumo" className="setup-card__logo" style={{ display: 'block', margin: '0 auto var(--sp-5)' }} />

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

        <LanguagePicker
          value={state.settings.language || 'en-US'}
          onChange={handleLanguageChange}
        />
      </div>
    </div>
  )
}
