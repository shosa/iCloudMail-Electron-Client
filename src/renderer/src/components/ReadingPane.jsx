import React, { useEffect, useState } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import {
  IconReply, IconReplyAll, IconForward, IconStar, IconMarkRead,
  IconTrash, IconNoSymbol, IconAttach, IconEnvelope,
  IconFileImage, IconFileDoc, IconDownload, IconClose
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
    if (parts.length >= 2) {
      return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase()
    }
    return [...parts[0]].slice(0, 2).join('').toUpperCase()
  }
  return [...(email || '?')].slice(0, 2).join('').toUpperCase()
}

const ADDR_COLORS = [
  '#0071e3','#5e5ebc','#bf5af2','#ff6b35',
  '#30d158','#ffd60a','#ff453a','#64d2ff'
]

function addrColor(name) {
  if (!name) return ADDR_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return ADDR_COLORS[Math.abs(h) % ADDR_COLORS.length]
}

function AddressChip({ address, onCompose, large }) {
  const a = typeof address === 'string' ? { email: address, name: '' } : (address || {})
  const email = a.email || ''
  const color = addrColor(a.name || email)
  const ini = getInitials(a.name, email)

  return (
    <div
      className={`address-chip${large ? ' address-chip--large' : ''}`}
      title={email}
      onClick={() => onCompose?.(email)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onCompose?.(email)}
    >
      <div className="address-chip__avatar" style={{ background: color }}>{ini}</div>
      <span className="address-chip__name">{a.name || email}</span>
      <div className="address-chip__popover">
        {a.name && <div className="address-chip__popover-name">{a.name}</div>}
        <div className="address-chip__popover-email">{email}</div>
      </div>
    </div>
  )
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
  const [attachmentMeta, setAttachmentMeta] = useState([])
  const [imagesBlocked, setImagesBlocked] = useState(state.settings.blockRemoteImages)
  const [imagesLoadedByUser, setImagesLoadedByUser] = useState(false)
  const [filePreview, setFilePreview] = useState(null)   // { src, filename, isPdf, localPath }
  const [loadingIdx, setLoadingIdx] = useState(null)

  useEffect(() => {
    if (!msg) { setBody(null); setAttachmentMeta([]); return }
    setBody(null)
    setAttachmentMeta([])
    setBodyLoading(true)
    setImagesLoadedByUser(false)
    setImagesBlocked(state.settings.blockRemoteImages)
    dispatch({ type: 'SET_LOADING', payload: t('loading.email') })

    Promise.all([
      window.api.imap.fetchBody(msg.folder, msg.uid),
      window.api.imap.getAttachmentMeta(msg.uid, msg.folder)
    ]).then(([bodyResult, metaResult]) => {
      if (bodyResult.ok) setBody(bodyResult.body)
      if (metaResult.ok && metaResult.metas?.length) setAttachmentMeta(metaResult.metas)
      setBodyLoading(false)
      dispatch({ type: 'CLEAR_LOADING' })
    }).catch(() => { setBodyLoading(false); dispatch({ type: 'CLEAR_LOADING' }) })
  }, [msg?.uid, msg?.folder])

  function handleReply() {
    window.api.window.openCompose({ mode: 'reply', message: msg, body })
  }
  function handleReplyAll() {
    window.api.window.openCompose({ mode: 'replyAll', message: msg, body })
  }
  function handleForward() {
    window.api.window.openCompose({ mode: 'forward', message: msg, body })
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

  async function handlePreviewAttachment(att, idx) {
    if (!msg || loadingIdx !== null) return
    const partId  = att.partId || String(idx + 1)
    const isImage = att.type?.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(att.filename || '')
    const isPdf   = att.type === 'application/pdf' || /\.pdf$/i.test(att.filename || '')
    if (!isImage && !isPdf) {
      // Non-previewable: save dialog
      await handleSaveAttachment(att, idx)
      return
    }
    setLoadingIdx(idx)
    try {
      const dlResult = await window.api.imap.downloadAttachment(
        msg.folder, msg.uid, partId, att.filename, state.auth.email
      )
      if (!dlResult.ok) { console.error('Download failed:', dlResult.error); return }
      const src = `kumo-local:///${dlResult.filePath.replace(/\\/g, '/')}`
      setFilePreview({ src, filename: att.filename, isPdf, localPath: dlResult.filePath })
    } catch (err) {
      console.error('Preview error:', err.message)
    } finally {
      setLoadingIdx(null)
    }
  }

  async function handleSaveAttachment(att, idx) {
    if (!msg) return
    const partId = att.partId || String(idx + 1)
    try {
      const dlResult = await window.api.imap.downloadAttachment(
        msg.folder, msg.uid, partId, att.filename, state.auth.email
      )
      if (dlResult.ok) {
        await window.api.dialog.saveFile(dlResult.filePath, att.filename)
      }
    } catch (err) {
      console.error('Save error:', err.message)
    }
  }

  if (!msg) {
    return (
      <div className="reading-pane">
        <div className="reading-pane__empty">
          <div style={{ opacity: 0.2, marginBottom: 'var(--sp-3)' }}><IconEnvelope size={52} /></div>
          <span className="reading-pane__empty-text">{t('reading.noMessage')}</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 200 }}>
            {t('reading.noMessageDesc')}
          </span>
          <button
            className="btn btn--ghost"
            style={{ marginTop: 'var(--sp-4)' }}
            onClick={() => window.api.window.openCompose({ mode: 'new' })}
          >
            {t('action.compose')}
          </button>
        </div>
      </div>
    )
  }

  const isRead = msg.flags?.includes('\\Seen')
  const isStarred = msg.flags?.includes('\\Flagged')
  const textContent = body?.text || ''

  // Build attachment list: DB metadata is the source of truth (from bodyStructure),
  // supplemented by partId/type from simpleParser when available
  const parsedAtts = body?.attachments || []
  const attachments = (() => {
    if (attachmentMeta.length > 0) {
      return attachmentMeta
        .filter(m => !m.is_inline || m.filename)  // skip inline images with no filename
        .map(m => {
          const parsed = parsedAtts.find(a => a.partId === m.part_id || a.filename === m.filename)
          return {
            filename: m.filename || 'attachment',
            size: m.size || parsed?.size || 0,
            type: m.content_type || parsed?.type || 'application/octet-stream',
            partId: m.part_id
          }
        })
    }
    return parsedAtts
  })()

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
      {filePreview && (
        <div
          className="image-preview-overlay"
          onClick={() => setFilePreview(null)}
          onKeyDown={e => e.key === 'Escape' && setFilePreview(null)}
          role="dialog"
          aria-label={t('reading.imagePreview')}
        >
          <div className="image-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="image-preview-modal__header">
              <span className="truncate" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{filePreview.filename}</span>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <button
                  className="btn btn--ghost"
                  style={{ fontSize: 'var(--text-sm)' }}
                  onClick={() => window.api.dialog.saveFile(filePreview.localPath, filePreview.filename)}
                >
                  <IconDownload size={14} />
                </button>
                <button className="btn btn--icon" onClick={() => setFilePreview(null)} title={t('action.close')}>
                  <IconClose size={16} />
                </button>
              </div>
            </div>
            <div className="image-preview-modal__body">
              {filePreview.isPdf ? (
                <iframe
                  src={filePreview.src}
                  title={filePreview.filename}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 'var(--radius-md)' }}
                />
              ) : (
                <img src={filePreview.src} alt={filePreview.filename} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 'var(--radius-md)' }} />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="reading-pane__header">
        <h2 className="reading-pane__subject">{msg.subject || t('reading.noSubject')}</h2>

        <div className="reading-pane__meta">
          <div className="reading-pane__meta-info">
            <div className="reading-pane__recipients">
              <span className="reading-pane__recipients-label">{t('reading.from')}</span>
              <div className="reading-pane__chips">
                <AddressChip
                  address={{ name: msg.from_name, email: msg.from_email }}
                  large
                  onCompose={em => window.api.window.openCompose({ mode: 'new', to: em })}
                />
              </div>
            </div>
            {(msg.to_addresses?.length > 0) && (
              <div className="reading-pane__recipients">
                <span className="reading-pane__recipients-label">{t('reading.to')}</span>
                <div className="reading-pane__chips">
                  {(msg.to_addresses || []).map((a, i) => (
                    <AddressChip key={i} address={a} onCompose={em => window.api.window.openCompose({ mode: 'new', to: em })} />
                  ))}
                </div>
              </div>
            )}
            {(msg.cc_addresses?.length > 0) && (
              <div className="reading-pane__recipients">
                <span className="reading-pane__recipients-label">{t('reading.cc')}</span>
                <div className="reading-pane__chips">
                  {(msg.cc_addresses || []).map((a, i) => (
                    <AddressChip key={i} address={a} onCompose={em => window.api.window.openCompose({ mode: 'new', to: em })} />
                  ))}
                </div>
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
          aria-label={isStarred ? t('action.unstar') : t('action.star')}
        ><IconStar size={16} /></button>

        <button
          className="btn btn--icon"
          onClick={handleToggleRead}
          title={isRead ? t('action.markUnread') : t('action.markRead')}
          aria-label={isRead ? t('action.markUnread') : t('action.markRead')}
        ><IconMarkRead size={16} /></button>

        <button
          className="btn btn--icon"
          onClick={handleMarkJunk}
          title={t('action.markJunk')}
          aria-label={t('action.markJunk')}
        ><IconNoSymbol size={16} /></button>

        <button
          className="btn btn--icon btn--danger"
          onClick={handleDelete}
          title={t('action.delete')}
          aria-label={t('action.delete')}
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
            <AttachmentChip
              key={i}
              attachment={att}
              loading={loadingIdx === i}
              onPreview={() => handlePreviewAttachment(att, i)}
              onSave={() => handleSaveAttachment(att, i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentChip({ attachment, loading, onPreview, onSave }) {
  const isImage = attachment.type?.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(attachment.filename || '')
  const isPdf   = attachment.type === 'application/pdf' || /\.pdf$/i.test(attachment.filename || '')
  const canPreview = isImage || isPdf
  const sizeStr = attachment.size
    ? attachment.size > 1048576
      ? `${(attachment.size / 1048576).toFixed(1)} MB`
      : `${Math.round(attachment.size / 1024)} KB`
    : ''

  return (
    <div className={`attachment-chip${loading ? ' attachment-chip--loading' : ''}`}>
      <div
        className="attachment-chip__body"
        onClick={loading ? undefined : onPreview}
        title={canPreview ? attachment.filename : undefined}
        role={canPreview ? 'button' : undefined}
        tabIndex={canPreview ? 0 : undefined}
        onKeyDown={e => !loading && canPreview && e.key === 'Enter' && onPreview()}
        style={{ cursor: canPreview && !loading ? 'pointer' : 'default' }}
      >
        <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
          {loading ? <div className="spinner spinner--sm" /> : isImage ? <IconFileImage size={16} /> : <IconFileDoc size={16} />}
        </span>
        <span className="truncate" style={{ maxWidth: 180 }}>{attachment.filename}</span>
        {sizeStr && <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{sizeStr}</span>}
      </div>
      <div className="attachment-chip__sep" />
      <button
        className="attachment-chip__dl-btn"
        onClick={e => { e.stopPropagation(); onSave() }}
        title="Salva file"
        aria-label="Salva file"
      >
        <IconDownload size={13} />
      </button>
    </div>
  )
}
