# Rich Composer + Attachment Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composer production-grade (file attachments with progress, inline image paste, auto-save drafts, from-account selector) and make attachments in the reading pane downloadable and inline-rendered.

**Architecture:** File attachments are picked via `ipcRenderer.invoke('dialog:pick-files')` (new handler) and held in component state as `{name, size, type, path}` objects. On send, nodemailer receives `{path}` entries in the `attachments` array. Download goes through a new `imap:download-attachment` handler that streams the attachment part to a temp file and then calls `shell.openPath`.

**Tech Stack:** Tiptap `@tiptap/extension-image` (already installable), Electron `dialog.showOpenDialog`, nodemailer attachment objects.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/main/index.js` | Modify | `dialog:pick-files`, `imap:download-attachment`, `imap:get-attachment-meta` handlers |
| `src/main/imap/client.js` | Modify | `downloadAttachment(folder, uid, partId)` method |
| `src/main/smtp/index.js` | Modify | Accept `{path}` attachment objects |
| `src/preload/index.js` | Modify | Expose `api.dialog.pickFiles`, `api.imap.downloadAttachment`, `api.imap.getAttachmentMeta` |
| `src/renderer/src/components/ComposeWindow.jsx` | Modify | File picker UI, attachment chips, inline paste, draft auto-save, from-account selector |
| `src/renderer/src/components/ReadingPane.jsx` | Modify | Clickable attachment chips → download, inline image rendering |

---

## Task 1: File picker + attachment download IPC

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Add dialog import**

At the top of `index.js`, add `dialog` to the electron imports:

```javascript
import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, dialog } from 'electron'
```

- [ ] **Step 2: Add `dialog:pick-files` handler**

After the `shell:open-external` handler, add:

```javascript
// ── Dialog ────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Attach Files'
  })
  if (result.canceled) return { ok: true, files: [] }
  const files = result.filePaths.map(p => {
    const { statSync } = require('fs')
    const { basename } = require('path')
    let size = 0
    try { size = statSync(p).size } catch { /* ignore */ }
    return { path: p, name: basename(p), size }
  })
  return { ok: true, files }
})
```

- [ ] **Step 3: Add `imap:download-attachment` handler**

```javascript
ipcMain.handle('imap:download-attachment', async (_e, folder, uid, partId, filename, email) => {
  try {
    const client = getClient(email)
    if (!client) return { ok: false, error: 'Not connected' }

    const userDataPath = app.getPath('userData')
    const attDir = require('path').join(userDataPath, 'attachments')
    require('fs').mkdirSync(attDir, { recursive: true })
    const safeName = filename.replace(/[^a-z0-9._-]/gi, '_')
    const dest = require('path').join(attDir, `${uid}_${partId}_${safeName}`)

    const { downloaded, filePath } = await client.downloadAttachment(folder, uid, partId, dest)
    if (downloaded) {
      // Mark in DB
      const { getAttachmentsMeta, markAttachmentDownloaded } = await import('./store/db.js')
      const metas = getAttachmentsMeta(uid, folder)
      const meta = metas.find(m => m.part_id === partId && m.filename === filename)
      if (meta) markAttachmentDownloaded(meta.id, filePath)
    }
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 4: Add `imap:get-attachment-meta` handler**

```javascript
ipcMain.handle('imap:get-attachment-meta', async (_e, uid, folder) => {
  try {
    const { getAttachmentsMeta } = await import('./store/db.js')
    const metas = getAttachmentsMeta(uid, folder)
    return { ok: true, metas }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

---

## Task 2: `downloadAttachment` method in ImapClient

**Files:**
- Modify: `src/main/imap/client.js`

- [ ] **Step 1: Add download method**

Add this method to `ImapClient`, after `fetchBody`:

```javascript
  async downloadAttachment(folder, uid, partId, destPath) {
    if (!this.client) throw new Error('Not connected')
    const { createWriteStream } = await import('fs')
    const lock = await this.client.getMailboxLock(folder)
    try {
      const stream = await this.client.download(`${uid}`, partId, { uid: true })
      if (!stream?.content) throw new Error('No content stream returned')
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(destPath)
        stream.content.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', resolve)
        stream.content.pipe(ws)
      })
      return { downloaded: true, filePath: destPath }
    } finally {
      lock.release()
    }
  }
```

---

## Task 3: SMTP accepts path-based attachments

**Files:**
- Modify: `src/main/smtp/index.js`

- [ ] **Step 1: Read the current smtp/index.js**

The existing file creates a nodemailer transporter and calls `sendEmail(email, password, options)`. The `options.attachments` array currently accepts objects with `{ filename, content, contentType }`. Nodemailer also accepts `{ filename, path }` natively.

Confirm the current file. If it passes attachments directly to nodemailer as-is, no change is needed — nodemailer handles `{path}` objects. If it transforms attachments, ensure path-based objects are passed through:

```javascript
// In sendEmail, ensure attachments pass through as-is:
const mailOptions = {
  from: `"${options.fromName || email}" <${email}>`,
  to: options.to,
  cc: options.cc,
  bcc: options.bcc,
  subject: options.subject,
  html: options.html,
  text: options.text,
  attachments: options.attachments || [],  // nodemailer accepts {path} or {content} objects
  inReplyTo: options.inReplyTo,
  references: options.references
}
```

---

## Task 4: Composer — file attachments + inline paste + draft auto-save

**Files:**
- Modify: `src/renderer/src/components/ComposeWindow.jsx`

- [ ] **Step 1: Install tiptap Image extension**

This does NOT require a new npm install — `@tiptap/extension-image` ships in the StarterKit but needs explicit configuration. Add to the editor extensions:

```javascript
import Image from '@tiptap/extension-image'
// in useEditor extensions array:
Image.configure({ inline: true, allowBase64: true }),
```

- [ ] **Step 2: Add attachment state**

```javascript
  const [attachments, setAttachments] = useState([])  // [{name, size, path}]
  const [draftId, setDraftId] = useState(null)
  const draftTimer = useRef(null)
```

- [ ] **Step 3: Add file picker handler**

```javascript
  async function handleAttachFiles() {
    const result = await window.api.dialog.pickFiles()
    if (result.ok && result.files.length) {
      setAttachments(prev => [...prev, ...result.files])
    }
  }

  function removeAttachment(index) {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }
```

- [ ] **Step 4: Add inline image paste handler**

Inside the `useEditor` config, add an `editorProps.handlePaste` handler:

```javascript
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write your message…' }),
      Image.configure({ inline: true, allowBase64: true })
    ],
    editorProps: {
      handlePaste(view, event) {
        const items = event.clipboardData?.items || []
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (!file) return false
            const reader = new FileReader()
            reader.onload = e => {
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({ src: e.target.result })
                )
              )
            }
            reader.readAsDataURL(file)
            return true
          }
        }
        return false
      }
    },
    content: ''
  })
```

- [ ] **Step 5: Add draft auto-save**

```javascript
  useEffect(() => {
    if (!state.auth.email) return
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(async () => {
      const html = editor?.getHTML() || ''
      if (!to && !subject && html === '<p></p>') return  // empty draft, skip
      const draft = {
        id: draftId || undefined,
        account_email: state.auth.email,
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
  }, [to, cc, bcc, subject, attachments])
```

- [ ] **Step 6: Delete draft on send/discard**

In `handleSend`, after `setSent(true)`:
```javascript
      if (draftId) { window.api.drafts.delete(draftId); setDraftId(null) }
```

In `handleClose`:
```javascript
  function handleClose() {
    if (draftId) window.api.drafts.delete(draftId)
    dispatch({ type: 'CLOSE_COMPOSE' })
  }
```

- [ ] **Step 7: Pass attachments to send**

In `handleSend`, update `mailOptions`:

```javascript
    const mailOptions = {
      to, cc: cc || undefined, bcc: bcc || undefined, subject, html, text,
      fromName: creds.creds.email,
      inReplyTo:   msg?.message_id || undefined,
      references:  msg?.message_id || undefined,
      attachments: attachments.map(a => ({ filename: a.name, path: a.path }))
    }
```

- [ ] **Step 8: Render attachment chips in composer**

In the composer footer (before the send button), add:

```jsx
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
                    style={{ width: 18, height: 18, fontSize: 10 }}
                    onClick={() => removeAttachment(i)}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
```

- [ ] **Step 9: Add attach button to compose toolbar**

In the compose toolbar, after the last `ToolBtn`, before the spacer:

```jsx
          <div className="compose-toolbar__separator" />
          <ToolBtn onClick={handleAttachFiles} title="Attach files">📎</ToolBtn>
```

---

## Task 5: ReadingPane — clickable attachments + inline images

**Files:**
- Modify: `src/renderer/src/components/ReadingPane.jsx`

- [ ] **Step 1: Add download handler**

```javascript
  async function handleDownloadAttachment(att, idx) {
    if (!msg) return
    try {
      const result = await window.api.imap.downloadAttachment(
        msg.folder, msg.uid,
        att.partId || String(idx + 1),
        att.filename,
        state.auth.email
      )
      if (result.ok) {
        window.api.shell.openExternal(`file://${result.filePath}`)
      } else {
        dispatch({ type: 'ADD_NOTIFICATION', payload: { type: 'error', text: result.error || 'Download failed' } })
      }
    } catch (err) {
      dispatch({ type: 'ADD_NOTIFICATION', payload: { type: 'error', text: err.message } })
    }
  }
```

- [ ] **Step 2: Render inline images for image/* attachments in attachments strip**

Replace `AttachmentChip` with a smarter version that handles images:

```javascript
function AttachmentChip({ attachment, onDownload }) {
  const isImage = attachment.type?.startsWith('image/')
  const sizeStr = attachment.size
    ? attachment.size > 1048576
      ? `${(attachment.size / 1048576).toFixed(1)} MB`
      : `${Math.round(attachment.size / 1024)} KB`
    : ''

  return (
    <div
      className="attachment-chip attachment-chip--clickable"
      onClick={onDownload}
      title={`Download ${attachment.filename}`}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onDownload()}
    >
      <span style={{ fontSize: 16 }}>{isImage ? '🖼' : '📄'}</span>
      <span className="truncate" style={{ maxWidth: 200 }}>{attachment.filename}</span>
      {sizeStr && <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{sizeStr}</span>}
      <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>↓</span>
    </div>
  )
}
```

- [ ] **Step 3: Wire `onDownload` in the attachments strip**

```jsx
      {attachments.length > 0 && (
        <div className="attachments-strip">
          {attachments.map((att, i) => (
            <AttachmentChip
              key={i}
              attachment={att}
              onDownload={() => handleDownloadAttachment(att, i)}
            />
          ))}
        </div>
      )}
```

- [ ] **Step 4: Add `attachment-chip--clickable` CSS**

In `components.css`:

```css
.attachment-chip--clickable {
  cursor: pointer;
}
.attachment-chip--clickable:hover {
  background: var(--glass-fill-hover);
  border-color: var(--glass-border-light);
}
```

---

## Task 6: Preload — expose new APIs

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add `dialog` namespace**

```javascript
  // ── Dialog ──────────────────────────────────────────────────────────────────
  dialog: {
    pickFiles: () => ipcRenderer.invoke('dialog:pick-files')
  },
```

- [ ] **Step 2: Add new imap methods**

Inside the `imap` namespace:

```javascript
    downloadAttachment: (folder, uid, partId, filename, email) =>
      ipcRenderer.invoke('imap:download-attachment', folder, uid, partId, filename, email),
    getAttachmentMeta: (uid, folder) =>
      ipcRenderer.invoke('imap:get-attachment-meta', uid, folder),
```

---

## Checkpoint

After all tasks: output `✅ Phase 5+7 Composer+Attachments — file attachments send, inline paste works, attachments download from reading pane`
