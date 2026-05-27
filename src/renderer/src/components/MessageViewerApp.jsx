import React, { useEffect, useState, useRef } from 'react'
import {
  IconReply, IconReplyAll, IconForward, IconStar, IconMarkRead,
  IconTrash, IconNoSymbol, IconClose, IconAttach
} from './Icons'

const AVATAR_COLORS = ['#0071e3','#5e5ebc','#bf5af2','#ff6b35','#30d158','#ffd60a','#ff453a','#64d2ff']

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function getInitials(name, email) {
  if (name) {
    const p = name.trim().split(' ')
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase()
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

export default function MessageViewerApp({ message }) {
  const [body, setBody] = useState(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [settings, setSettings] = useState({ theme: 'light', blockRemoteImages: true })
  const [flags, setFlags] = useState(message?.flags || [])
  const [imagesBlocked, setImagesBlocked] = useState(true)
  const [imagesLoadedByUser, setImagesLoadedByUser] = useState(false)

  useEffect(() => {
    window.api.settings.get().then(r => {
      if (r.ok) {
        setSettings(r.settings)
        setImagesBlocked(r.settings.blockRemoteImages ?? true)
      }
    })
  }, [])

  useEffect(() => {
    if (!message) return
    setBodyLoading(true)
    window.api.imap.fetchBody(message.folder, message.uid)
      .then(r => { if (r.ok) setBody(r.body) })
      .catch(() => {})
      .finally(() => setBodyLoading(false))
  }, [message?.folder, message?.uid])

  if (!message) {
    return <div className={`app-root theme-light`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>No message data</div>
  }

  const isRead    = flags.includes('\\Seen')
  const isStarred = flags.includes('\\Flagged')
  const initials  = getInitials(message.from_name, message.from_email)
  const color     = getAvatarColor(message.from_name || message.from_email)
  const attachments = body?.attachments || []

  const hasRemoteImages = !!(body?.html && /src=["']https?:\/\//i.test(body.html))
  const showBlockedBanner = hasRemoteImages && imagesBlocked && !imagesLoadedByUser

  const renderHtml = body?.html
    ? buildSafeHTML(body.html, imagesBlocked && !imagesLoadedByUser)
    : null

  const iframeDoc = renderHtml ? `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#1d1d1f;background:#fff;margin:0;padding:20px 24px;word-break:break-word;overflow-x:hidden}
  a{color:#0071e3}
  img{max-width:100%;height:auto;display:block}
  img[data-blocked]{display:none!important}
  pre{white-space:pre-wrap;background:#f5f5f7;padding:12px;border-radius:8px;font-size:13px}
  blockquote{border-left:3px solid #d2d2d7;margin:8px 0 8px 8px;padding-left:12px;color:#6e6e73}
  table{border-collapse:collapse;max-width:100%}
</style></head><body>${renderHtml}</body></html>` : null

  async function handleToggleStar() {
    const next = !isStarred
    await window.api.imap.starMessage(message.folder, message.uid, next)
    setFlags(next ? [...flags, '\\Flagged'] : flags.filter(f => f !== '\\Flagged'))
  }

  async function handleToggleRead() {
    const next = !isRead
    await window.api.imap.markRead(message.folder, message.uid, next)
    setFlags(next ? [...flags, '\\Seen'] : flags.filter(f => f !== '\\Seen'))
  }

  async function handleDelete() {
    await window.api.imap.deleteMessage(message.folder, message.uid, false)
    window.close()
  }

  async function handleMarkJunk() {
    await window.api.imap.markJunk(message.folder, message.uid, true)
    window.close()
  }

  function openCompose(mode) {
    window.api.window.openComposeInMain({ mode, message: { ...message, flags }, body })
  }

  const theme = settings.theme || 'light'

  return (
    <div className={`app-root theme-${theme} viewer-window`}>
      {/* Viewer header — sits below native titlebar overlay (32px) */}
      <div className="viewer__header">
        <div className="viewer__toolbar">
          <button className="btn btn--ghost" onClick={() => openCompose('reply')} title="Reply">
            <IconReply size={15} /> Reply
          </button>
          <button className="btn btn--ghost" onClick={() => openCompose('replyAll')} title="Reply All">
            <IconReplyAll size={15} /> All
          </button>
          <button className="btn btn--ghost" onClick={() => openCompose('forward')} title="Forward">
            <IconForward size={15} /> Forward
          </button>

          <div style={{ flex: 1 }} />

          <button
            className={`btn btn--icon${isStarred ? ' active' : ''}`}
            onClick={handleToggleStar}
            title={isStarred ? 'Unstar' : 'Star'}
          ><IconStar size={16} /></button>

          <button
            className="btn btn--icon"
            onClick={handleToggleRead}
            title={isRead ? 'Mark unread' : 'Mark read'}
          ><IconMarkRead size={16} /></button>

          <button
            className="btn btn--icon"
            onClick={handleMarkJunk}
            title="Mark as Junk"
          ><IconNoSymbol size={16} /></button>

          <button
            className="btn btn--icon btn--danger"
            onClick={handleDelete}
            title="Delete"
          ><IconTrash size={16} /></button>

          <div style={{ width: 1, background: 'var(--glass-border)', height: 20, margin: '0 4px' }} />

          <button className="btn btn--icon" onClick={() => window.close()} title="Close window">
            <IconClose size={16} />
          </button>
        </div>

        <h2 className="viewer__subject">{message.subject || '(No subject)'}</h2>

        <div className="viewer__meta">
          <div className="viewer__meta-avatar" style={{ backgroundColor: color }}>{initials}</div>
          <div className="viewer__meta-info">
            <div className="viewer__from">{message.from_name || message.from_email}</div>
            {message.from_name && <div className="viewer__from-email">{message.from_email}</div>}
            {(message.to_addresses?.length > 0) && (
              <div className="viewer__to">
                To: {(message.to_addresses || []).map(a => a.name || a.email || a).join(', ')}
              </div>
            )}
          </div>
          <div className="viewer__date">{formatFullDate(message.date)}</div>
        </div>
      </div>

      {showBlockedBanner && (
        <div className="reading-pane__images-blocked">
          <span>Remote images blocked</span>
          <button
            className="btn btn--ghost"
            onClick={() => { setImagesBlocked(false); setImagesLoadedByUser(true) }}
            style={{ padding: 'var(--sp-1) var(--sp-3)', fontSize: 'var(--text-sm)' }}
          >Load Images</button>
        </div>
      )}

      <div className="viewer__body">
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
        ) : body?.text ? (
          <div className="reading-pane__plain-text">{body.text}</div>
        ) : !bodyLoading ? (
          <div style={{ padding: 'var(--sp-5)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            No content
          </div>
        ) : null}
      </div>

      {attachments.length > 0 && (
        <div className="attachments-strip">
          {attachments.map((att, i) => {
            const kb = att.size ? (att.size > 1048576 ? `${(att.size/1048576).toFixed(1)} MB` : `${Math.round(att.size/1024)} KB`) : ''
            return (
              <div key={i} className="attachment-chip" title={att.filename}>
                <IconAttach size={14} />
                <span className="truncate" style={{ maxWidth: 200 }}>{att.filename}</span>
                {kb && <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{kb}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
