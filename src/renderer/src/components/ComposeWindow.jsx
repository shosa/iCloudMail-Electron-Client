import React, { useState, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { useAppState, useAppDispatch } from '../context/AppContext'

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

function buildReplyTo(mode, msg) {
  if (mode === 'reply') return msg.from_email || ''
  if (mode === 'replyAll') {
    const all = [msg.from_email, ...(msg.to_addresses || []).map(a => a.email)].filter(Boolean)
    return [...new Set(all)].join(', ')
  }
  return ''
}

export default function ComposeWindow() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const { mode, referencedMessage } = state.compose
  const msg = referencedMessage

  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write your message…' })
    ],
    content: ''
  })

  useEffect(() => {
    if (!editor) return
    const replyBody = buildReplyBody(mode, msg, msg?.body)
    const sig = state.settings.signature
      ? `<p></p><p>--</p><p>${state.settings.signature}</p>`
      : '<p></p>'
    editor.commands.setContent(sig + (mode !== 'new' ? replyBody : ''))
    editor.commands.focus('start')
  }, [editor, mode, msg])

  useEffect(() => {
    if (!msg) return
    if (mode !== 'new') {
      setTo(buildReplyTo(mode, msg))
      setSubject(buildReplySubject(mode, msg.subject))
    }
  }, [mode, msg])

  async function handleSend() {
    if (!to.trim()) { setError('Please enter a recipient'); return }
    if (!subject.trim()) { setError('Please enter a subject'); return }
    setSending(true)
    setError(null)

    const html = editor?.getHTML() || ''
    const text = editor?.getText() || ''

    const creds = await window.api.auth.getCredentials()
    if (!creds.ok || !creds.creds) {
      setError('Could not retrieve credentials')
      setSending(false)
      return
    }

    const mailOptions = {
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      html,
      text,
      fromName: creds.creds.email,
      inReplyTo: msg?.message_id || undefined,
      references: msg?.message_id || undefined
    }

    const result = await window.api.smtp.send(creds.creds.email, creds.creds.password, mailOptions)
    if (result.ok) {
      setSent(true)
      setTimeout(() => dispatch({ type: 'CLOSE_COMPOSE' }), 1200)
    } else {
      setError(result.error || 'Failed to send message')
      setSending(false)
    }
  }

  function handleClose() {
    dispatch({ type: 'CLOSE_COMPOSE' })
  }

  const windowTitle = {
    new: 'New Message',
    reply: `Re: ${msg?.subject || ''}`,
    replyAll: `Re: ${msg?.subject || ''} (All)`,
    forward: `Fwd: ${msg?.subject || ''}`
  }[mode] || 'Compose'

  const ToolBtn = ({ onClick, active, title, children }) => (
    <button
      className={`btn btn--icon${active ? ' active' : ''}`}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      style={{ fontSize: 13, width: 28, height: 28 }}
    >
      {children}
    </button>
  )

  return (
    <div className="compose-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="compose-window">
        {/* Header */}
        <div className="compose-window__header">
          <span className="compose-window__title truncate">{windowTitle}</span>
          <button className="btn btn--icon" onClick={handleClose}>✕</button>
        </div>

        {/* Address fields */}
        <div className="compose-window__fields">
          <div className="compose-field">
            <span className="compose-field__label">To</span>
            <input
              className="compose-field__input"
              placeholder="recipient@example.com"
              value={to}
              onChange={e => setTo(e.target.value)}
              type="email"
              multiple
            />
            <button
              className="btn btn--icon"
              onClick={() => setShowCcBcc(v => !v)}
              title="Show Cc/Bcc"
              style={{ fontSize: 11 }}
            >
              Cc/Bcc
            </button>
          </div>

          {showCcBcc && (
            <>
              <div className="compose-field">
                <span className="compose-field__label">Cc</span>
                <input
                  className="compose-field__input"
                  placeholder="cc@example.com"
                  value={cc}
                  onChange={e => setCc(e.target.value)}
                />
              </div>
              <div className="compose-field">
                <span className="compose-field__label">Bcc</span>
                <input
                  className="compose-field__input"
                  placeholder="bcc@example.com"
                  value={bcc}
                  onChange={e => setBcc(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="compose-field">
            <span className="compose-field__label">Sub</span>
            <input
              className="compose-field__input"
              placeholder="Subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
          </div>
        </div>

        {/* Rich text toolbar */}
        <div className="compose-toolbar">
          <ToolBtn onClick={() => editor?.chain().focus().toggleBold().run()}
            active={editor?.isActive('bold')} title="Bold">𝐁</ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleItalic().run()}
            active={editor?.isActive('italic')} title="Italic">𝐼</ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleUnderline().run()}
            active={editor?.isActive('underline')} title="Underline">U̲</ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleStrike().run()}
            active={editor?.isActive('strike')} title="Strikethrough">S̶</ToolBtn>

          <div className="compose-toolbar__separator" />

          <ToolBtn onClick={() => editor?.chain().focus().toggleBulletList().run()}
            active={editor?.isActive('bulletList')} title="Bullet list">≡</ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            active={editor?.isActive('orderedList')} title="Numbered list">1.</ToolBtn>

          <div className="compose-toolbar__separator" />

          <ToolBtn onClick={() => editor?.chain().focus().setTextAlign('left').run()}
            active={editor?.isActive({ textAlign: 'left' })} title="Align left">⬅</ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().setTextAlign('center').run()}
            active={editor?.isActive({ textAlign: 'center' })} title="Center">↔</ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().setTextAlign('right').run()}
            active={editor?.isActive({ textAlign: 'right' })} title="Align right">➡</ToolBtn>

          <div className="compose-toolbar__separator" />

          <ToolBtn onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            active={editor?.isActive('blockquote')} title="Blockquote">"</ToolBtn>

          <div className="compose-toolbar__spacer" />
        </div>

        {/* Editor */}
        <div className="compose-window__editor">
          <div className="tiptap-editor">
            {editor && <EditorContent editor={editor} />}
          </div>
        </div>

        {/* Footer */}
        <div className="compose-window__footer">
          <div style={{ flex: 1 }}>
            {error && (
              <div className="setup-error" style={{ padding: 'var(--sp-2) var(--sp-3)' }}>{error}</div>
            )}
            {sent && (
              <div style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)' }}>
                ✓ Sent!
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button className="btn btn--ghost" onClick={handleClose}>Discard</button>
            <button
              className="btn btn--primary"
              onClick={handleSend}
              disabled={sending || sent || !to.trim()}
            >
              {sending ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Sending…
                </>
              ) : '✈ Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
