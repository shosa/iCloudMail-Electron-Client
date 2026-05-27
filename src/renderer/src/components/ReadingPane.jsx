import React, { useEffect, useState, useRef } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import {
  IconReply, IconReplyAll, IconForward, IconStar, IconMarkRead,
  IconTrash, IconNoSymbol, IconAttach, IconEnvelope
} from './Icons'

const AVATAR_COLORS = [
  '#0071e3','#5e5ebc','#bf5af2','#ff6b35',
  '#30d158','#ffd60a','#ff453a','#64d2ff'
]

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(' ')
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (email || '?').slice(0, 2).toUpperCase()
}

function formatFullDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function buildSafeHTML(html, blockImages) {
  let safe = html || ''
  if (blockImages) {
    safe = safe.replace(/<img\s/gi, '<img data-blocked="true" style="display:none" ')
    safe = safe.replace(/url\(['"]?https?:\/\/[^'")\s]+['"]?\)/gi, 'url()')
  }
  return safe
}

export default function ReadingPane() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const msg = state.messages.selected
  const [body, setBody] = useState(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [imagesBlocked, setImagesBlocked] = useState(state.settings.blockRemoteImages)
  const [imagesLoadedByUser, setImagesLoadedByUser] = useState(false)

  useEffect(() => {
    if (!msg) { setBody(null); return }
    setBody(null)
    setBodyLoading(true)
    setImagesLoadedByUser(false)
    setImagesBlocked(state.settings.blockRemoteImages)
    dispatch({ type: 'SET_LOADING', payload: t('loading.email') })

    window.api.imap.fetchBody(msg.folder, msg.uid).then(result => {
      if (result.ok) setBody(result.body)
      setBodyLoading(false)
      dispatch({ type: 'CLEAR_LOADING' })
    }).catch(() => { setBodyLoading(false); dispatch({ type: 'CLEAR_LOADING' }) })
  }, [msg?.uid, msg?.folder])

  function handleReply() {
    dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'reply', message: { ...msg, body } } })
  }
  function handleReplyAll() {
    dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'replyAll', message: { ...msg, body } } })
  }
  function handleForward() {
    dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'forward', message: { ...msg, body } } })
  }

  function handleDelete() {
    if (!msg) return
    dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: msg.uid, folder: msg.folder } })
    window.api.imap.deleteMessage(msg.folder, msg.uid, false)
  }

  function handleToggleStar() {
    if (!msg) return
    const isStarred = msg.flags?.includes('\\Flagged')
    const newFlags = isStarred
      ? msg.flags.filter(f => f !== '\\Flagged')
      : [...(msg.flags || []), '\\Flagged']
    dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: msg.uid, folder: msg.folder, flags: newFlags } })
    window.api.imap.starMessage(msg.folder, msg.uid, !isStarred)
  }

  function handleToggleRead() {
    if (!msg) return
    const isRead = msg.flags?.includes('\\Seen')
    const newFlags = isRead
      ? msg.flags.filter(f => f !== '\\Seen')
      : [...(msg.flags || []), '\\Seen']
    dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: msg.uid, folder: msg.folder, flags: newFlags } })
    window.api.imap.markRead(msg.folder, msg.uid, !isRead)
  }

  function handleMarkJunk() {
    if (!msg) return
    dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: msg.uid, folder: msg.folder } })
    window.api.imap.markJunk(msg.folder, msg.uid, true)
  }

  if (!msg) {
    return (
      <div className="reading-pane">
        <div className="reading-pane__empty">
          <span className="reading-pane__empty-icon" style={{ fontSize: 40 }}><IconEnvelope size={48} style={{ opacity: 0.3 }} /></span>
          <span className="reading-pane__empty-text">{t('reading.noMessage')}</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            {t('reading.noMessageDesc')}
          </span>
        </div>
      </div>
    )
  }

  const isRead = msg.flags?.includes('\\Seen')
  const isStarred = msg.flags?.includes('\\Flagged')
  const initials = getInitials(msg.from_name, msg.from_email)
  const color = getAvatarColor(msg.from_name || msg.from_email)
  const textContent = body?.text || ''
  const attachments = body?.attachments || []

  const hasRemoteImages = !!(body?.html && /src=["']https?:\/\//i.test(body.html))

  const renderHtml = body?.html
    ? buildSafeHTML(body.html, imagesBlocked && !imagesLoadedByUser)
    : null

  const iframeDoc = renderHtml
    ? `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1d1d1f;
    background: #ffffff;
    margin: 0;
    padding: 20px 24px;
    word-break: break-word;
    overflow-x: hidden;
  }
  a { color: #0071e3; }
  img { max-width: 100%; height: auto; display: block; }
  img[data-blocked] { display: none !important; }
  pre { white-space: pre-wrap; background: #f5f5f7; padding: 12px; border-radius: 8px; font-size: 13px; }
  blockquote { border-left: 3px solid #d2d2d7; margin: 8px 0 8px 8px; padding-left: 12px; color: #6e6e73; }
  table { border-collapse: collapse; max-width: 100%; }
</style>
</head>
<body>${renderHtml}</body>
</html>`
    : null

  return (
    <div className="reading-pane">
      <div className="reading-pane__header">
        <h2 className="reading-pane__subject">{msg.subject || t('reading.noSubject')}</h2>

        <div className="reading-pane__meta">
          <div className="reading-pane__meta-avatar" style={{ backgroundColor: color }}>{initials}</div>
          <div className="reading-pane__meta-info">
            <div className="reading-pane__from">{msg.from_name || msg.from_email}</div>
            {msg.from_name && <div className="reading-pane__from-email">{msg.from_email}</div>}
            {(msg.to_addresses?.length > 0) && (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                {t('reading.to')} {(msg.to_addresses || []).map(a => a.name || a.email || a).join(', ')}
              </div>
            )}
          </div>
          <div className="reading-pane__meta-right">{formatFullDate(msg.date)}</div>
        </div>
      </div>

      <div className="reading-pane__toolbar">
        <button className="btn btn--ghost" onClick={handleReply} title={t('action.reply')}>
          <IconReply size={14} /> {t('action.reply')}
        </button>
        <button className="btn btn--ghost" onClick={handleReplyAll} title={t('action.replyAll')}>
          <IconReplyAll size={14} /> {t('action.all')}
        </button>
        <button className="btn btn--ghost" onClick={handleForward} title={t('action.forward')}>
          <IconForward size={14} /> {t('action.forward')}
        </button>

        <div className="reading-pane__toolbar-spacer" />

        <button
          className={`btn btn--icon${isStarred ? ' active' : ''}`}
          onClick={handleToggleStar}
          title={isStarred ? t('action.unstar') : t('action.star')}
        ><IconStar size={16} /></button>

        <button
          className="btn btn--icon"
          onClick={handleToggleRead}
          title={isRead ? t('action.markUnread') : t('action.markRead')}
        ><IconMarkRead size={16} /></button>

        <button
          className="btn btn--icon"
          onClick={handleMarkJunk}
          title={t('action.markJunk')}
        ><IconNoSymbol size={16} /></button>

        <button
          className="btn btn--icon btn--danger"
          onClick={handleDelete}
          title={t('action.delete')}
        ><IconTrash size={16} /></button>
      </div>

      {hasRemoteImages && imagesBlocked && !imagesLoadedByUser && (
        <div className="reading-pane__images-blocked">
          <span>{t('reading.imagesBlocked')}</span>
          <button
            className="btn btn--ghost"
            onClick={() => { setImagesBlocked(false); setImagesLoadedByUser(true) }}
            style={{ padding: 'var(--sp-1) var(--sp-3)', fontSize: 'var(--text-sm)' }}
          >{t('action.loadImages')}</button>
        </div>
      )}

      <div className="reading-pane__body">
        {bodyLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : iframeDoc ? (
          <iframe
            className="reading-pane__webview"
            sandbox="allow-same-origin allow-popups"
            srcDoc={iframeDoc}
            title="Email body"
          />
        ) : textContent ? (
          <div className="reading-pane__plain-text">{textContent}</div>
        ) : (
          <div style={{ padding: 'var(--sp-5)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {t('reading.noContent')}
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="attachments-strip">
          {attachments.map((att, i) => (
            <AttachmentChip key={i} attachment={att} />
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentChip({ attachment }) {
  const sizeStr = attachment.size
    ? attachment.size > 1048576
      ? `${(attachment.size / 1048576).toFixed(1)} MB`
      : `${Math.round(attachment.size / 1024)} KB`
    : ''

  return (
    <div className="attachment-chip" title={`Download ${attachment.filename}`}>
      <IconAttach size={14} />
      <span className="truncate" style={{ maxWidth: 200 }}>{attachment.filename}</span>
      {sizeStr && <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{sizeStr}</span>}
    </div>
  )
}
