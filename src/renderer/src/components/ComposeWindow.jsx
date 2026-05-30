import React, { useState, useEffect, useRef } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
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
  if (mode === 'forward') {
    return subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`
  }
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

// Address parsing utilities
function isValidEmailAddress(email) {
  if (!email || typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function parseAddressString(input) {
  if (!input || typeof input !== 'string') return []

  const addresses = []
  // Split by comma or semicolon, but not within angle brackets
  const parts = input.split(/[,;](?![^<]*>)/).map(s => s.trim()).filter(Boolean)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // RFC 5322 format: "Name <email@domain.com>"
    const namedMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/)
    if (namedMatch) {
      const name = namedMatch[1].trim().replace(/^["']|["']$/g, '') // Remove quotes
      const email = namedMatch[2].trim()
      addresses.push({
        name,
        address: email,
        isValid: isValidEmailAddress(email),
        display: `${name} <${email}>`
      })
    } else {
      // Bare email format: "email@domain.com"
      const email = trimmed
      addresses.push({
        name: '',
        address: email,
        isValid: isValidEmailAddress(email),
        display: email
      })
    }
  }

  return addresses
}

function AddressChip({ address, onRemove, removeLabel }) {
  const chipClass = `address-chip${!address.isValid ? ' address-chip--invalid' : ''}`
  return (
    <span className={chipClass}>
      <span className="address-chip__text">
        {address.name ? `${address.name} <${address.address}>` : address.address}
      </span>
      <button
        className="address-chip__remove"
        onClick={onRemove}
        type="button"
        aria-label={removeLabel}
      >
        ×
      </button>
    </span>
  )
}

function RecipientField({ label, addresses, onChange, placeholder, trailing }) {
  const state = useAppState()
  const t = useTranslation()
  const [suggestions, setSuggestions] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const query = inputValue.trim()
    if (!query || query.length < 2 || !focused) { setSuggestions([]); return }
    const contacts = state.contacts?.list || []
    const lower = query.toLowerCase()
    const matches = contacts.filter(c =>
      (c.display_name || '').toLowerCase().includes(lower) ||
      (c.email || '').toLowerCase().includes(lower)
    ).slice(0, 6)
    setSuggestions(matches)
  }, [inputValue, focused, state.contacts?.list])

  useEffect(() => {
    function close(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setSuggestions([])
        parseAndAddAddresses()
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [inputValue])

  function parseAndAddAddresses() {
    if (!inputValue.trim()) return

    const newAddresses = parseAddressString(inputValue)
    if (newAddresses.length > 0) {
      onChange([...addresses, ...newAddresses])
      setInputValue('')
      setSuggestions([])
    }
  }

  function pickContact(contact) {
    const email = contact.email || ''
    const name = contact.display_name || ''
    const newAddress = {
      name,
      address: email,
      isValid: isValidEmailAddress(email),
      display: name ? `${name} <${email}>` : email
    }
    onChange([...addresses, newAddress])
    setInputValue('')
    setSuggestions([])
  }

  function removeAddress(index) {
    const newAddresses = addresses.filter((_, i) => i !== index)
    onChange(newAddresses)
  }

  function handleKeyDown(e) {
    const key = e.key

    if (key === 'Enter' || key === 'Tab' || key === ',' || key === ';') {
      e.preventDefault()
      parseAndAddAddresses()
      if (key === 'Tab') {
        // Let tab continue to next field after parsing
        setTimeout(() => {
          const nextElement = document.querySelector(`input:not([tabindex="-1"]), button:not([tabindex="-1"])`)
          if (nextElement) nextElement.focus()
        }, 0)
      }
    } else if (key === 'Backspace' && !inputValue && addresses.length > 0) {
      // Remove last chip if input is empty and backspace is pressed
      removeAddress(addresses.length - 1)
    }
  }

  function handlePaste(e) {
    e.preventDefault()
    const pastedText = (e.clipboardData || window.clipboardData).getData('text')
    const newAddresses = parseAddressString(pastedText)
    if (newAddresses.length > 0) {
      onChange([...addresses, ...newAddresses])
    }
  }

  return (
    <div className="compose-field" ref={wrapRef} style={{ position: 'relative' }}>
      <span className="compose-field__label">{label}</span>
      <div className="compose-field__chip-input">
        {addresses.map((addr, i) => (
          <AddressChip
            key={i}
            address={addr}
            onRemove={() => removeAddress(i)}
            removeLabel={t('action.remove')}
          />
        ))}
        <input
          ref={inputRef}
          className="compose-field__input"
          placeholder={addresses.length === 0 ? placeholder : ''}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          autoComplete="off"
          style={{ border: 'none', outline: 'none', flex: 1, minWidth: '120px' }}
        />
      </div>
      {trailing}
      {suggestions.length > 0 && (
        <div className="compose-autocomplete">
          {suggestions.map((c, i) => (
            <div
              key={i}
              className="compose-autocomplete__item"
              onMouseDown={() => pickContact(c)}
            >
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

export default function ComposeWindow() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const { mode, referencedMessage } = state.compose
  const msg = referencedMessage

  const [to, setTo] = useState([])
  const [cc, setCc] = useState([])
  const [bcc, setBcc] = useState([])
  const [subject, setSubject] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(mode === 'replyAll')
  const [sending, setSending] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [draftId, setDraftId] = useState(null)
  const [bodyVersion, setBodyVersion] = useState(0)
  const draftTimer = useRef(null)
  const editorRef = useRef(null)

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
    const replyBody = buildReplyBody(mode, msg, msg?.body)
    const sig = state.settings.signature
      ? `<p></p><p>--</p><p>${state.settings.signature}</p>`
      : '<p></p>'
    setEditorContent(sig + (mode !== 'new' ? replyBody : ''))
  }, [mode, msg, state.settings.signature])

  useEffect(() => {
    if (!msg) return
    if (mode !== 'new') {
      const replyToString = buildReplyTo(mode, msg, state.auth.email)
      setTo(parseAddressString(replyToString))
      setSubject(buildReplySubject(mode, msg.subject))
      if (mode === 'replyAll') setShowCcBcc(true)
    }
  }, [mode, msg])

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
    if (!state.auth.email) return
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(async () => {
      const html = editorContent || ''
      if (to.length === 0 && !subject && html === '<p></p>') return

      // Convert address arrays to strings for draft storage
      const formatAddresses = (addresses) => addresses.map(addr =>
        addr.name ? `${addr.name} <${addr.address}>` : addr.address
      ).join(', ')

      const draft = {
        id: draftId || undefined,
        account_email: state.auth.email,
        subject,
        to_field: formatAddresses(to),
        cc_field: formatAddresses(cc),
        bcc_field: formatAddresses(bcc),
        body_html: html,
        in_reply_to: msg?.message_id || null,
        message_refs: msg?.message_id || null,
        attachments
      }
      const result = await window.api.drafts.save(draft)
      if (result.ok && result.id && !draftId) setDraftId(result.id)
    }, 2000)
    return () => clearTimeout(draftTimer.current)
  }, [to, cc, bcc, subject, attachments, bodyVersion, draftId])

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

  async function handleSend() {
    // Check if we have recipients
    if (to.length === 0) { setError(t('compose.error.noRecipient')); return }
    if (!subject.trim()) { setError(t('compose.error.noSubject')); return }

    // Check for invalid addresses
    const allAddresses = [...to, ...cc, ...bcc]
    const invalidAddresses = allAddresses.filter(addr => !addr.isValid)
    if (invalidAddresses.length > 0) {
      setError(t('compose.error.invalidAddresses'))
      return
    }

    setSending(true)
    setError(null)

    const html = editorRef.current?.getHTML() || editorContent || ''
    const text = editorContent.replace(/<[^>]*>/g, '') || ''

    const creds = await window.api.auth.getCredentials()
    if (!creds.ok || !creds.creds) {
      setError(t('compose.error.noCredentials'))
      setSending(false)
      return
    }

    const fromName = creds.creds.email

    // Convert address arrays to strings for email sending
    const formatAddresses = (addresses) => addresses.map(addr =>
      addr.name ? `${addr.name} <${addr.address}>` : addr.address
    ).join(', ')

    const mailOptions = {
      to: formatAddresses(to),
      cc: cc.length > 0 ? formatAddresses(cc) : undefined,
      bcc: bcc.length > 0 ? formatAddresses(bcc) : undefined,
      subject,
      html,
      text,
      fromName,
      inReplyTo: msg?.message_id || undefined,
      references: msg?.message_id || undefined,
      attachments: attachments.map(a => ({ filename: a.name, path: a.path }))
    }

    // Optimistic sending: add to outbox and show as sent immediately
    const outboxEmail = {
      accountEmail: creds.creds.email,
      to: formatAddresses(to),
      cc: cc.length > 0 ? formatAddresses(cc) : undefined,
      bcc: bcc.length > 0 ? formatAddresses(bcc) : undefined,
      subject,
      html,
      text,
      inReplyTo: msg?.message_id || undefined,
      references: msg?.message_id || undefined,
      attachments: attachments.map(a => ({ filename: a.name, path: a.path }))
    }

    const result = await window.api.smtp.sendOptimistic(outboxEmail)
    if (result.ok) {
      if (draftId) { window.api.drafts.delete(draftId); setDraftId(null) }
      setSent(true)
      setTimeout(() => dispatch({ type: 'CLOSE_COMPOSE' }), 1200)
    } else {
      setError(result.error || t('compose.error.failedSend'))
      setSending(false)
    }
  }

  async function handleSaveDraft() {
    const html = editorRef.current?.getHTML() || editorContent || ''

    // Convert address arrays to strings for draft storage
    const formatAddresses = (addresses) => addresses.map(addr =>
      addr.name ? `${addr.name} <${addr.address}>` : addr.address
    ).join(', ')

    const draft = {
      id: draftId || undefined,
      account_email: state.auth.email,
      subject,
      to_field: formatAddresses(to),
      cc_field: formatAddresses(cc),
      bcc_field: formatAddresses(bcc),
      body_html: html,
      in_reply_to: msg?.message_id || null,
      message_refs: msg?.message_id || null,
      attachments
    }
    const result = await window.api.drafts.save(draft)
    if (result.ok && result.id && !draftId) setDraftId(result.id)
    dispatch({ type: 'CLOSE_COMPOSE' })
  }

  function handleClose() {
    dispatch({ type: 'CLOSE_COMPOSE' })
  }

  const windowTitle = (() => {
    if (mode === 'new') return t('compose.title.new')
    const prefix = mode === 'forward' ? 'Fwd:' : 'Re:'
    const suffix = mode === 'replyAll' ? ` ${t('compose.title.replyAll')}` : ''
    return `${prefix} ${msg?.subject || ''}${suffix}`
  })()

  return (
    <div className="compose-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="compose-window" onClick={() => setContextMenu(null)}>
        {/* Header */}
        <div className="compose-window__header">
          <span className="compose-window__title truncate">{windowTitle}</span>
          <button className="btn btn--icon" onClick={handleClose} title={t('action.close')}>
            <IconClose size={16} />
          </button>
        </div>

        {/* Address fields */}
        <div className="compose-window__fields">
          <RecipientField
            label={t('compose.to')}
            addresses={to}
            onChange={setTo}
            placeholder={t('compose.recipientPlaceholder')}
            trailing={
              <button
                className="compose-field__cc-toggle"
                onClick={() => setShowCcBcc(v => !v)}
                title={t('compose.ccBcc')}
              >
                {t('compose.ccBcc')}
              </button>
            }
          />

          {showCcBcc && (
            <>
              <RecipientField
                label={t('compose.cc')}
                addresses={cc}
                onChange={setCc}
                placeholder={t('compose.ccPlaceholder')}
              />
              <RecipientField
                label={t('compose.bcc')}
                addresses={bcc}
                onChange={setBcc}
                placeholder={t('compose.bccPlaceholder')}
              />
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

        {/* Attachments */}
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

        {/* Editor */}
        <div className="compose-window__editor">
          <div className="compose-editor" onContextMenu={handleContextMenu}>
            <RichTextEditor
              ref={editorRef}
              value={editorContent}
              onChange={(html) => {
                setEditorContent(html)
                setBodyVersion(v => v + 1)
              }}
              placeholder={t('compose.placeholder')}
              modules={quillModules}
            />
          </div>
        </div>

        {/* Attachment list */}
        {attachments.length > 0 && (
          <div className="compose-attachments">
            {attachments.map((att, i) => (
              <div key={i} className="attachment-chip">
                <span className="truncate" style={{ maxWidth: 140 }}>{att.name}</span>
                <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  {att.size > 1048576
                    ? `${(att.size / 1048576).toFixed(1)} MB`
                    : `${Math.round(att.size / 1024)} KB`}
                </span>
                <button
                  className="btn btn--icon"
                  style={{ width: 18, height: 18 }}
                  onClick={() => removeAttachment(i)}
                  title={t('action.close')}
                >
                  <IconClose size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="compose-window__footer">
          <div style={{ flex: 1 }}>
            {error && (
              <div className="setup-error" style={{ padding: 'var(--sp-2) var(--sp-3)' }}>{error}</div>
            )}
            {sent && (
              <div style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                {t('compose.sent')}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button className="btn btn--ghost" onClick={handleSaveDraft}>
              {t('compose.saveDraft')}
            </button>
            <button className="btn btn--ghost" onClick={handleClose}>
              {t('compose.discard')}
            </button>
            <button
              className="btn btn--primary"
              onClick={handleSend}
              disabled={sending || sent || to.length === 0 || [...to, ...cc, ...bcc].some(addr => !addr.isValid)}
            >
              {sending ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  {t('compose.sending')}
                </>
              ) : (
                <>
                  <IconSend size={14} />
                  {t('compose.send')}
                </>
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
