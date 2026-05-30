import React from 'react'
import { useTranslation } from '../i18n/index'

export default function TitleBar({ connectionStatus }) {
  const t = useTranslation()

  const statusLabel = {
    connected: t('status.connected'),
    connecting: t('status.connecting'),
    reconnecting: t('status.reconnecting'),
    disconnected: '',
    error: t('status.error')
  }[connectionStatus] || ''

  const dotClass = {
    connected: 'titlebar__status-dot--connected',
    connecting: 'titlebar__status-dot--connecting',
    reconnecting: 'titlebar__status-dot--connecting',
    error: 'titlebar__status-dot--error'
  }[connectionStatus] || ''

  return (
    <div className="titlebar">
      {/* Left: title + connection status — far from native Win controls on the right */}
      <div className="titlebar__left">
        <span className="titlebar__title">Kumo</span>
        {statusLabel && (
          <div className="titlebar__status">
            <span className={`titlebar__status-dot ${dotClass}`} />
            <span>{statusLabel}</span>
          </div>
        )}
      </div>
      {/* Right area is intentionally empty — native Windows min/max/close live here */}
    </div>
  )
}
