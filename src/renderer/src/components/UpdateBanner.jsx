import React, { useState, useEffect } from 'react'
import { useTranslation } from '../i18n'

export default function UpdateModal() {
  const t = useTranslation()
  const [status, setStatus] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [localPercent, setLocalPercent] = useState(0)

  useEffect(() => {
    const off = window.api.on('updater:status', (data) => {
      if (data.event === 'not-available' || data.event === 'checking') return
      if (data.event === 'progress') {
        setPreparing(false)
        setLocalPercent(data.percent)
      }
      if (data.event === 'downloaded' || data.event === 'error') {
        setPreparing(false)
      }
      setDismissed(false)
      setStatus(prev => ({ ...prev, ...data }))
    })
    return () => off?.()
  }, [])

  if (!status || dismissed) return null

  const isDownloading = preparing || status.event === 'progress'
  const percent = status.event === 'progress' ? status.percent : localPercent

  function handleDownload() {
    setPreparing(true)
    setLocalPercent(0)
    setStatus(s => ({ ...s, event: 'progress', percent: 0 }))
    window.api.updater.download()
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.5)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
    }}>
      <div style={{
        width: 400,
        background: 'var(--bg-layer1)',
        border: '1px solid var(--glass-border-light)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.55), var(--glass-inner-glow)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        padding: '28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-5)',
        animation: 'scaleIn 200ms var(--ease-spring)',
      }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            borderRadius: 'var(--radius-md)',
            background: status.event === 'error'
              ? 'rgba(255, 69, 58, 0.15)'
              : status.event === 'downloaded'
                ? 'rgba(48, 209, 88, 0.15)'
                : 'var(--accent-subtle)',
            border: '1px solid var(--glass-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {status.event === 'error' ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            ) : status.event === 'downloaded' ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-md)',
              color: 'var(--text-primary)',
              lineHeight: 1.3,
            }}>
              {status.event === 'downloaded'
                ? t('update.ready', status.version)
                : status.event === 'error'
                  ? t('update.errorTitle')
                  : t('update.available', status.version)}
            </div>
            <div style={{
              marginTop: 4,
              fontSize: 'var(--text-sm)',
              color: status.event === 'error' ? 'var(--color-error)' : 'var(--text-secondary)',
              lineHeight: 1.4,
            }}>
              {status.event === 'error'
                ? (status.message || t('update.errorUnknown'))
                : status.event === 'downloaded'
                  ? t('update.readyDesc')
                  : isDownloading
                    ? (percent > 0 ? t('update.downloading', percent) : t('update.preparing'))
                    : t('update.availableDesc')}
            </div>
          </div>
        </div>

        {/* Progress bar — visible while downloading or done */}
        {(isDownloading || status.event === 'downloaded') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <div style={{
              height: 6,
              borderRadius: 'var(--radius-full)',
              background: 'var(--glass-border)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                borderRadius: 'var(--radius-full)',
                background: status.event === 'downloaded' ? 'var(--color-success)' : 'var(--accent)',
                width: status.event === 'downloaded' ? '100%' : `${Math.max(2, percent)}%`,
                transition: 'width 300ms linear, background 400ms ease',
              }} />
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
            }}>
              <span>
                {status.event === 'downloaded'
                  ? t('update.downloadComplete')
                  : percent > 0
                    ? t('update.downloading', percent)
                    : t('update.preparing')}
              </span>
              {status.event === 'progress' && (
                <span style={{ color: 'var(--accent)', fontWeight: 'var(--weight-medium)' }}>
                  {percent}%
                </span>
              )}
              {status.event === 'downloaded' && (
                <span style={{ color: 'var(--color-success)' }}>100%</span>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
          {/* Later / Dismiss always available except mid-download */}
          {!isDownloading && (
            <button
              onClick={() => setDismissed(true)}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--glass-border)',
                background: 'var(--glass-fill)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'background var(--duration-fast) var(--ease-default)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--glass-fill-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--glass-fill)' }}
            >
              {t('update.later')}
            </button>
          )}

          {/* Download button — only in 'available' state */}
          {status.event === 'available' && !isDownloading && (
            <button
              onClick={handleDownload}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'background var(--duration-fast) var(--ease-default)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
            >
              {t('update.download')}
            </button>
          )}

          {/* Downloading — non-interactive status indicator */}
          {isDownloading && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
            }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              {percent > 0 ? `${percent}%` : t('update.preparing')}
            </div>
          )}

          {/* Restart & Update — only when download complete */}
          {status.event === 'downloaded' && (
            <button
              onClick={() => window.api.updater.install()}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-success)',
                color: '#fff',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'filter var(--duration-fast) var(--ease-default)',
              }}
              onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)' }}
              onMouseLeave={e => { e.currentTarget.style.filter = '' }}
            >
              {t('update.restart')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
