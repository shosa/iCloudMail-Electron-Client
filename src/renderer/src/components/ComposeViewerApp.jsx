import React, { useState, useEffect, useRef } from 'react'
import { locales } from '../i18n/index'
import RichTextEditor from './RichTextEditor'
import {
  IconClose, IconAttach, IconSend
} from './Icons'

function buildReplyBody(mode, msg, body) {
  if (!msg) return ''
  const fromLine = `From: ${msg.from_name || msg.from_email} &lt;${msg.from_email}&gt;`
  const dateLine = `Date: ${new Date(msg.date).toLocaleString()}`
  const subjectLine = `Subject: ${msg.subject}`
  const toLine = `To: ${(msg.to_addresses || []).map(a => a.name || a.email).join(', ')}`
  const original = body?.html
    ? `<blockquote style="border-left:3px solid #d2d2d7;margin:12px 0 0 8px;padding-left:12px;color:#6e6e73">${body.html}</blockquote>`
    : `<pre style="color:#6e6e73;font-size:13px">${body?.text || ''}</pre>`
  if (mode === 'forward') {
    return `<p></p><p>---------- Forwarded message ----------</p><p>${fromLine}<br>${dateLine}<br>${subjectLine}<br>${toLine}</p>${original}`
  }
  return `<p></p><p>On ${dateLine}, ${msg.from_name || msg.from_email} wrote:</p>${original}`
}

function buildReplySubject(mode, subject) {
  if (!subject) return mode === 'forward' ? 'Fwd: ' : 'Re: '
  if (mode === 'forward') return subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`
  return subject.startsWith('Re:') ? subject : `Re: ${subject}`
}

function buildReplyTo(mode, msg, selfEmail) {
  if (mode === 'reply') return msg.from_email || ''
  if (mode === 'replyAll') {
    const all = [msg.from_email, ...(msg.to_addresses || []).map(a => a.email)].filter(Boolean)
    return [...new Set(all)]
      .filter(e => e.toLowerCase() !== (selfEmail || '').toLowerCase())
      .join(', ')
  }
  return ''
}

function RecipientField({ label, value, onChange, placeholder, trailing, contacts }) {
  const [suggestions, setSuggestions] = useState([])
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const q = value.split(/[,;]\s*/).pop().trim()
    if (!q || q.length < 2 || !focused) { setSuggestions([]); return }
    const lower = q.toLowerCase()
    const matches = (contacts || []).filter(c =>
      (c.display_name || '').toLowerCase().includes(lower) ||
      (c.email || '').toLowerCase().includes(lower)
    ).slice(0, 6)
    setSuggestions(matches)
  }, [value, focused, contacts])

  useEffect(() => {
    function close(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setSuggestions([]) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function pickContact(contact) {
    const email = contact.email || ''
    const display = contact.display_name ? `${contact.display_name} <${email}>` : email
    const parts = value.split(/[,;]\s*/)
    parts[parts.length - 1] = display
    onChange(parts.join(', ') + ', ')
    setSuggestions([])
  }

  return (
    <div className="compose-field" ref={wrapRef} style={{ position: 'relative' }}>
      <span className="compose-field__label">{label}</span>
      <input
        className="compose-field__input"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoComplete="off"
      />
      {trailing}
      {suggestions.length > 0 && (
        <div className="compose-autocomplete">
          {suggestions.map((c, i) => (
            <div key={i} className="compose-autocomplete__item" onMouseDown={() => pickContact(c)}>
              <span className="compose-autocomplete__name">{c.display_name || c.email}</span>
              {c.display_name && c.email && (
                <span className="compose-autocomplete__email">{c.email}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ComposeViewerApp({ composeData }) {
  const { mode = 'new', message: msg, body, to: initialTo = '' } = composeData || {}

  const [settings, setSettings] = useState({ theme: 'light', signature: '', language: 'en-US' })
  const [contacts, setContacts] = useState([])
  const [accountEmail, setAccountEmail] = useState('')
  const [to, setTo] = useState(initialTo || (msg && mode !== 'new' ? buildReplyTo(mode, msg, '') : ''))
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(msg && mode !== 'new' ? buildReplySubject(mode, msg.subject) : '')
  const [showCcBcc, setShowCcBcc] = useState(mode === 'replyAll')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [draftId, setDraftId] = useState(null)
  const [bodyVersion, setBodyVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState(null)
  const draftTimer = useRef(null)
  const editorRef = useRef(null)

  useEffect(() => {
    window.api.settings.get().then(r => {
      if (r.ok) setSettings(r.settings)
    })
    window.api.auth.getCredentials().then(r => {
      if (r.ok && r.creds) {
        const email = r.creds.email
        setAccountEmail(email)
        if (msg && mode === 'replyAll') setTo(buildReplyTo(mode, msg, email))
        window.api.contacts.list(email).then(res => {
          if (res.ok) setContacts(res.contacts || [])
        })
      }
    })
  }, [])

  const [editorContent, setEditorContent] = useState('')

  // Quill configuration completa come Outlook
  const quillModules = {
    toolbar: {
      container: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        [{ 'align': [] }],
        ['blockquote', 'code-block'],
        ['link', 'image', 'video'],
        ['clean']
      ]
    },
    clipboard: {
      matchVisual: false
    }
  }

  useEffect(() => {
    const replyBody = buildReplyBody(mode, msg, body || msg?.body)
    const sig = settings.signature
      ? `<p></p><p>--</p><p>${settings.signature}</p>`
      : '<p></p>'
    setEditorContent(sig + (mode !== 'new' ? replyBody : ''))
  }, [mode, msg, body, settings.signature])

  async function handleAttachFiles() {
    const result = await window.api.dialog.pickFiles()
    if (result.ok && result.files.length) {
      setAttachments(prev => [...prev, ...result.files])
    }
  }

  function removeAttachment(index) {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  useEffect(() => {
    if (!accountEmail) return
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(async () => {
      const html = editorContent || ''
      if (!to && !subject && html === '<p></p>') return
      const draft = {
        id: draftId || undefined,
        account_email: accountEmail,
        subject,
        to_field: to,
        cc_field: cc,
        bcc_field: bcc,
        body_html: html,
        in_reply_to: msg?.message_id || null,
        message_refs: msg?.message_id || null,
        attachments
      }
      const result = await window.api.drafts.save(draft)
      if (result.ok && result.id && !draftId) setDraftId(result.id)
    }, 2000)
    return () => clearTimeout(draftTimer.current)
  }, [to, cc, bcc, subject, attachments, accountEmail, bodyVersion, draftId])

  async function handleSend() {
    if (!to.trim()) { setError('compose.error.noRecipient'); return }
    if (!subject.trim()) { setError('compose.error.noSubject'); return }
    setSending(true)
    setError(null)

    const html = editorRef.current?.getHTML() || editorContent || ''
    const text = editorContent.replace(/<[^>]*>/g, '') || ''

    const creds = await window.api.auth.getCredentials()
    if (!creds.ok || !creds.creds) {
      setError('compose.error.noCredentials')
      setSending(false)
      return
    }

    const fromName = creds.creds.email

    const mailOptions = {
      to, cc: cc || undefined, bcc: bcc || undefined,
      subject, html, text,
      fromName,
      inReplyTo: msg?.message_id || undefined,
      references: msg?.message_id || undefined,
      attachments: attachments.map(a => ({ filename: a.name, path: a.path }))
    }

    const result = await window.api.smtp.send(creds.creds.email, creds.creds.password, mailOptions)
    if (result.ok) {
      if (draftId) { window.api.drafts.delete(draftId) }
      setSent(true)
      setTimeout(() => window.close(), 1200)
    } else {
      setError(result.error || 'compose.error.failedSend')
      setSending(false)
    }
  }

  async function handleSaveDraft() {
    if (!accountEmail) return
    const html = editorRef.current?.getHTML() || editorContent || ''
    const draft = {
      id: draftId || undefined,
      account_email: accountEmail,
      subject,
      to_field: to,
      cc_field: cc,
      bcc_field: bcc,
      body_html: html,
      in_reply_to: msg?.message_id || null,
      message_refs: msg?.message_id || null,
      attachments
    }
    await window.api.drafts.save(draft)
    window.close()
  }

  function handleContextMenu(e) {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      selectedText: editorRef.current?.getSelectedText()?.trim() || ''
    })
  }

  async function handleEditorContextAction(action) {
    try {
      switch (action) {
        case 'copy':
          await editorRef.current?.copySelection()
          break
        case 'cut':
          await editorRef.current?.cutSelection()
          break
        case 'paste':
          await editorRef.current?.pasteText()
          break
        case 'selectAll':
          editorRef.current?.selectAll()
          break
        case 'clearFormatting':
          editorRef.current?.clearSelectionFormatting()
          break
        case 'attach':
          await handleAttachFiles()
          break
      }
    } catch (err) {
      console.warn('Compose context action failed:', err)
    }
    setContextMenu(null)
  }

  const locale = locales[settings.language] || locales['en-US']
  const t = (key) => (locale || locales['en-US'])[key] ?? key

  const placeholderText = t('compose.placeholder')

  const windowTitle = (() => {
    if (mode === 'new') return t('compose.title.new')
    const prefix = mode === 'forward' ? 'Fwd:' : 'Re:'
    const suffix = mode === 'replyAll' ? ` ${t('compose.title.replyAll')}` : ''
    return `${prefix} ${msg?.subject || ''}${suffix}`
  })()

  const theme = settings.theme || 'light'

  return (
    <div className={`app-root theme-${theme} viewer-window`} onClick={() => setContextMenu(null)}>
      {/* Drag region for the native titlebar overlay area */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 150, height: 32, WebkitAppRegion: 'drag', zIndex: 9999 }} />
      <div className="compose-window compose-window--standalone">
        <div className="compose-window__header">
          <span className="compose-window__title truncate">{windowTitle}</span>
        </div>

        <div className="compose-window__fields">
          <RecipientField
            label={t('compose.to')}
            value={to}
            onChange={setTo}
            placeholder={t('compose.recipientPlaceholder')}
            contacts={contacts}
            trailing={
              <button className="compose-field__cc-toggle" onClick={() => setShowCcBcc(v => !v)} title={t('compose.ccBcc')}>
                {t('compose.ccBcc')}
              </button>
            }
          />
          {showCcBcc && (
            <>
              <RecipientField label={t('compose.cc')} value={cc} onChange={setCc} placeholder={t('compose.ccPlaceholder')} contacts={contacts} />
              <RecipientField label={t('compose.bcc')} value={bcc} onChange={setBcc} placeholder={t('compose.bccPlaceholder')} contacts={contacts} />
            </>
          )}
          <div className="compose-field">
            <span className="compose-field__label">{t('compose.subject')}</span>
            <input
              className="compose-field__input"
              placeholder={t('compose.subject')}
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
          </div>
        </div>

        <div className="compose-toolbar">
          <button
            className="compose-tool-btn"
            onMouseDown={e => e.preventDefault()}
            onClick={handleAttachFiles}
            title={t('compose.attach')}
            aria-label={t('compose.attach')}
          >
            <IconAttach size={15} />
          </button>
          <div className="compose-toolbar__spacer" />
        </div>

        <div className="compose-window__editor">
          <div className="compose-editor" onContextMenu={handleContextMenu}>
            <RichTextEditor
              ref={editorRef}
              value={editorContent}
              onChange={(html) => {
                setEditorContent(html)
                setBodyVersion(v => v + 1)
              }}
              modules={quillModules}
              placeholder={placeholderText}
            />
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="compose-attachments">
            {attachments.map((att, i) => (
              <div key={i} className="attachment-chip">
                <span className="truncate" style={{ maxWidth: 140 }}>{att.name}</span>
                <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  {att.size > 1048576 ? `${(att.size / 1048576).toFixed(1)} MB` : `${Math.round(att.size / 1024)} KB`}
                </span>
                <button className="btn btn--icon" style={{ width: 18, height: 18 }} onClick={() => removeAttachment(i)} title={t('action.close')}>
                  <IconClose size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="compose-window__footer">
          <div style={{ flex: 1 }}>
            {error && <div className="setup-error" style={{ padding: 'var(--sp-2) var(--sp-3)' }}>{t(error)}</div>}
            {sent && <div style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)' }}>{t('compose.sent')}</div>}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button className="btn btn--ghost" onClick={handleSaveDraft}>{t('compose.saveDraft')}</button>
            <button className="btn btn--ghost" onClick={() => window.close()}>{t('compose.discard')}</button>
            <button className="btn btn--primary" onClick={handleSend} disabled={sending || sent || !to.trim()}>
              {sending ? (
                <><span className="spinner" style={{ width: 14, height: 14 }} />{t('compose.sending')}</>
              ) : (
                <><IconSend size={14} />{t('compose.send')}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          className="email-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.selectedText && (
            <button className="email-context-menu__item" onClick={() => handleEditorContextAction('copy')}>
              {t('action.copy')}
            </button>
          )}
          {contextMenu.selectedText && (
            <button className="email-context-menu__item" onClick={() => handleEditorContextAction('cut')}>
              {t('action.cut')}
            </button>
          )}
          <button className="email-context-menu__item" onClick={() => handleEditorContextAction('paste')}>
            {t('action.paste')}
          </button>
          <button className="email-context-menu__item" onClick={() => handleEditorContextAction('selectAll')}>
            {t('action.selectAll')}
          </button>
          {contextMenu.selectedText && (
            <button className="email-context-menu__item" onClick={() => handleEditorContextAction('clearFormatting')}>
              {t('action.clearFormatting')}
            </button>
          )}
          <button className="email-context-menu__item" onClick={() => handleEditorContextAction('attach')}>
            {t('compose.attach')}
          </button>
        </div>
      )}
    </div>
  )
}
