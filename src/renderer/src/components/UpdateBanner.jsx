import React, { useState, useEffect } from 'react'
import { useTranslation } from '../i18n'

export default function UpdateBanner() {
  const t = useTranslation()
  const [state, setState] = useState(null)

  useEffect(() => {
    const off = window.api.on('updater:status', (data) => {
      if (data.event === 'not-available' || data.event === 'checking') return
      setState(data)
    })
    return () => off?.()
  }, [])

  if (!state || state.event === 'error') return null

  const dismiss = () => setState(null)

  if (state.event === 'available') {
    return (
      <div className="update-banner">
        <span className="update-banner__text">{t('update.available', state.version)}</span>
        <button className="update-banner__btn update-banner__btn--primary" onClick={() => window.api.updater.download()}>
          {t('update.download')}
        </button>
        <button className="update-banner__btn" onClick={dismiss}>{t('update.later')}</button>
      </div>
    )
  }

  if (state.event === 'progress') {
    return (
      <div className="update-banner">
        <span className="update-banner__text">{t('update.downloading', state.percent)}</span>
        <div className="update-banner__bar">
          <div className="update-banner__bar-fill" style={{ width: `${state.percent}%` }} />
        </div>
      </div>
    )
  }

  if (state.event === 'downloaded') {
    return (
      <div className="update-banner update-banner--ready">
        <span className="update-banner__text">{t('update.ready', state.version)}</span>
        <button className="update-banner__btn update-banner__btn--primary" onClick={() => window.api.updater.install()}>
          {t('update.restart')}
        </button>
        <button className="update-banner__btn" onClick={dismiss}>{t('update.later')}</button>
      </div>
    )
  }

  return null
}
