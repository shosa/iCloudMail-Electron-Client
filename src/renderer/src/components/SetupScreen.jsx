import React, { useState } from 'react'
import { useAppDispatch } from '../context/AppContext'

export default function SetupScreen() {
  const dispatch = useAppDispatch()
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
      // Test connection
      const connectResult = await window.api.imap.connect(email.trim(), password.trim())
      if (!connectResult.ok) {
        setError(connectResult.error || 'Could not connect to iCloud. Check your credentials.')
        setLoading(false)
        return
      }

      // Save credentials via safeStorage
      const saveResult = await window.api.auth.saveCredentials(email.trim(), password.trim())
      if (!saveResult.ok) {
        setError('Credentials saved but connection failed: ' + saveResult.error)
        setLoading(false)
        return
      }

      dispatch({ type: 'SET_AUTHENTICATED', payload: email.trim() })
    } catch (err) {
      setError(err.message || 'Connection failed')
      setLoading(false)
    }
  }

  function openAppleHelp() {
    window.api.shell.openExternal('https://support.apple.com/HT204397')
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-card__logo">✉</div>

        <h1 className="setup-card__title">Kumo</h1>
        <p className="setup-card__subtitle">
          Sign in with your iCloud email address and an app-specific password.
          Your credentials are encrypted using Windows DPAPI.
        </p>

        <form className="setup-form" onSubmit={handleSubmit}>
          <div>
            <label className="input-label" htmlFor="email">iCloud Email Address</label>
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
            <label className="input-label" htmlFor="app-password">
              App-Specific Password
            </label>
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
                Connecting…
              </>
            ) : (
              'Sign In'
            )}
          </button>

          <p className="setup-help">
            Need an app-specific password?{' '}
            <button
              type="button"
              onClick={openAppleHelp}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', padding: 0 }}
            >
              Learn how →
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
