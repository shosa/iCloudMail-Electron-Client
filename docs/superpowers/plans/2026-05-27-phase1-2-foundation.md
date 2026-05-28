# Foundation: IMAP Delta Sync + Persistence Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full-inbox resync on every connect with UID-based delta sync, and extend the SQLite schema to hold the tables all future phases depend on (sync_state, accounts, drafts, attachments, FTS5).

**Architecture:** The DB migration runs once inside `initDB()` behind a `schemaVersion` guard. The IMAP client reads/writes `sync_state` to know the highest UID it has already persisted; on reconnect it fetches only `lastUid+1:*`. FTS5 index is kept in sync by explicit calls inside `upsertMessage()` and `saveMessageBody()`.

**Tech Stack:** sql.js 1.12.0 (SQLite WASM with FTS5), imapflow 1.0.x, Electron 29 main process.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/main/store/db.js` | Modify | Schema migration, new tables, new helper functions, FTS5 |
| `src/main/imap/client.js` | Modify | UID-based delta sync, snippet extraction, thread-id computation, IDLE fix, sync-complete event |
| `src/main/index.js` | Modify | New IPC handlers: `imap:sync-folder`, `store:get-sync-state`, forward `sync-complete` event |
| `src/preload/index.js` | Modify | Expose `api.imap.syncFolder()`, `api.store.getSyncState()` |

---

## Task 1: DB schema migration guard + new tables

**Files:**
- Modify: `src/main/store/db.js` (lines 22–111, the `initDB` function and after)

- [ ] **Step 1: Write a `_runMigrations` function after `getDB`**

Insert after the `oneRow` helper (line 132) in `db.js`:

```javascript
function _runMigrations(d) {
  // Read current schema version
  let ver = 0
  try {
    const s = d.prepare(`SELECT value FROM settings WHERE key = 'schemaVersion'`)
    if (s.step()) ver = parseInt(JSON.parse(s.getAsObject().value), 10) || 0
    s.free()
  } catch { /* settings table not yet created */ }

  if (ver >= 1) return

  // sync_state: tracks last synced UID per (account, folder)
  d.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      account_email TEXT NOT NULL,
      folder        TEXT NOT NULL,
      last_uid      INTEGER DEFAULT 0,
      last_sync_at  INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      PRIMARY KEY (account_email, folder)
    )
  `)

  // accounts: multi-account registry (credentials stored separately via safeStorage)
  d.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT    UNIQUE NOT NULL,
      display_name TEXT,
      imap_host    TEXT    DEFAULT 'imap.mail.me.com',
      imap_port    INTEGER DEFAULT 993,
      smtp_host    TEXT    DEFAULT 'smtp.mail.me.com',
      smtp_port    INTEGER DEFAULT 587,
      auth_type    TEXT    DEFAULT 'password',
      is_default   INTEGER DEFAULT 0,
      created_at   INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)

  // drafts: persist compose state across sessions
  d.run(`
    CREATE TABLE IF NOT EXISTS drafts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_email TEXT,
      subject       TEXT    DEFAULT '',
      to_field      TEXT    DEFAULT '',
      cc_field      TEXT    DEFAULT '',
      bcc_field     TEXT    DEFAULT '',
      body_html     TEXT    DEFAULT '',
      in_reply_to   TEXT,
      message_refs  TEXT,
      attachments   TEXT    DEFAULT '[]',
      created_at    INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at    INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)

  // attachments: metadata only; binary stored on disk under userData/attachments/
  d.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      uid          INTEGER NOT NULL,
      folder       TEXT    NOT NULL,
      message_id   TEXT,
      part_id      TEXT,
      filename     TEXT,
      content_type TEXT    DEFAULT 'application/octet-stream',
      size         INTEGER DEFAULT 0,
      content_id   TEXT,
      is_inline    INTEGER DEFAULT 0,
      file_path    TEXT,
      downloaded   INTEGER DEFAULT 0
    )
  `)
  d.run(`CREATE INDEX IF NOT EXISTS idx_att_uid_folder ON attachments(uid, folder)`)

  // Add new columns to messages (ALTER TABLE is safe; fails silently if column exists)
  const existingCols = new Set(
    (d.exec(`PRAGMA table_info(messages)`)[0]?.values || []).map(r => r[1])
  )
  const newCols = [
    ['account_email', 'TEXT'],
    ['thread_id',     'TEXT'],
    ['in_reply_to',   'TEXT'],
    ['message_refs',  'TEXT']
  ]
  for (const [col, type] of newCols) {
    if (!existingCols.has(col)) d.run(`ALTER TABLE messages ADD COLUMN ${col} ${type}`)
  }
  d.run(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`)

  // FTS5 index over searchable message fields (standalone, not content-table)
  d.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      uid       UNINDEXED,
      folder    UNINDEXED,
      subject,
      body_text,
      from_name,
      from_email
    )
  `)

  // Back-fill FTS5 from existing messages
  d.run(`
    INSERT INTO messages_fts(uid, folder, subject, body_text, from_name, from_email)
    SELECT uid, folder,
           COALESCE(subject,''),
           COALESCE(body_text,''),
           COALESCE(from_name,''),
           COALESCE(from_email,'')
    FROM messages
  `)

  d.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('schemaVersion', '1')`)
}
```

- [ ] **Step 2: Call `_runMigrations(db)` at the end of `initDB()`, right before `return db`**

In `db.js`, find the line `persistDB()` followed by `return db` (around line 109). Change it to:

```javascript
  _runMigrations(db)
  persistDB()
  return db
```

- [ ] **Step 3: Verify no syntax errors by reviewing the full initDB block**

Re-read lines 22–115 of `src/main/store/db.js` and confirm:
- `_runMigrations(db)` is called after all base `CREATE TABLE` statements
- It is called before `persistDB()`

---

## Task 2: New DB helper functions

**Files:**
- Modify: `src/main/store/db.js` (append after `closeDB` at the end)

- [ ] **Step 1: Add sync_state helpers**

```javascript
export function getSyncState(accountEmail, folder) {
  const d = getDB()
  const stmt = d.prepare(
    `SELECT last_uid, last_sync_at, message_count FROM sync_state WHERE account_email = ? AND folder = ?`
  )
  stmt.bind([accountEmail, folder])
  return oneRow(stmt)
}

export function upsertSyncState(accountEmail, folder, lastUid, messageCount) {
  const d = getDB()
  d.run(`
    INSERT INTO sync_state (account_email, folder, last_uid, last_sync_at, message_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_email, folder) DO UPDATE SET
      last_uid      = excluded.last_uid,
      last_sync_at  = excluded.last_sync_at,
      message_count = excluded.message_count
  `, [accountEmail, folder, lastUid, Date.now(), messageCount])
  scheduleSave()
}
```

- [ ] **Step 2: Add accounts helpers**

```javascript
export function upsertAccount(account) {
  const d = getDB()
  d.run(`
    INSERT INTO accounts (email, display_name, imap_host, imap_port, smtp_host, smtp_port, auth_type, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      display_name = excluded.display_name,
      imap_host    = excluded.imap_host,
      imap_port    = excluded.imap_port,
      smtp_host    = excluded.smtp_host,
      smtp_port    = excluded.smtp_port,
      auth_type    = excluded.auth_type,
      is_default   = excluded.is_default
  `, [
    account.email,
    account.display_name || account.email,
    account.imap_host  || 'imap.mail.me.com',
    account.imap_port  || 993,
    account.smtp_host  || 'smtp.mail.me.com',
    account.smtp_port  || 587,
    account.auth_type  || 'password',
    account.is_default ? 1 : 0
  ])
  scheduleSave()
}

export function getAccounts() {
  const d = getDB()
  return allRows(d.prepare(`SELECT * FROM accounts ORDER BY is_default DESC, id ASC`))
}

export function deleteAccount(email) {
  const d = getDB()
  d.run(`DELETE FROM accounts WHERE email = ?`, [email])
  d.run(`DELETE FROM sync_state WHERE account_email = ?`, [email])
  scheduleSave()
}
```

- [ ] **Step 3: Add draft helpers**

```javascript
export function upsertDraft(draft) {
  const d = getDB()
  if (draft.id) {
    d.run(`
      UPDATE drafts SET
        account_email = ?, subject = ?, to_field = ?, cc_field = ?, bcc_field = ?,
        body_html = ?, in_reply_to = ?, message_refs = ?, attachments = ?,
        updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `, [
      draft.account_email || null, draft.subject || '', draft.to_field || '',
      draft.cc_field || '', draft.bcc_field || '', draft.body_html || '',
      draft.in_reply_to || null, draft.message_refs || null,
      JSON.stringify(draft.attachments || []), draft.id
    ])
    scheduleSave()
    return draft.id
  }
  d.run(`
    INSERT INTO drafts (account_email, subject, to_field, cc_field, bcc_field, body_html, in_reply_to, message_refs, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    draft.account_email || null, draft.subject || '', draft.to_field || '',
    draft.cc_field || '', draft.bcc_field || '', draft.body_html || '',
    draft.in_reply_to || null, draft.message_refs || null,
    JSON.stringify(draft.attachments || [])
  ])
  scheduleSave()
  return d.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0]
}

export function getDrafts(accountEmail) {
  const d = getDB()
  const stmt = d.prepare(
    `SELECT * FROM drafts WHERE account_email = ? OR account_email IS NULL ORDER BY updated_at DESC`
  )
  stmt.bind([accountEmail])
  const rows = allRows(stmt)
  return rows.map(r => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }))
}

export function deleteDraft(id) {
  const d = getDB()
  d.run(`DELETE FROM drafts WHERE id = ?`, [id])
  scheduleSave()
}
```

- [ ] **Step 4: Add attachment metadata helpers**

```javascript
export function upsertAttachmentMeta(att) {
  const d = getDB()
  d.run(`
    INSERT OR IGNORE INTO attachments
      (uid, folder, message_id, part_id, filename, content_type, size, content_id, is_inline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    att.uid, att.folder, att.message_id || null,
    att.part_id || null, att.filename || 'attachment',
    att.content_type || 'application/octet-stream', att.size || 0,
    att.content_id || null, att.is_inline ? 1 : 0
  ])
  scheduleSave()
}

export function getAttachmentsMeta(uid, folder) {
  const d = getDB()
  const stmt = d.prepare(`SELECT * FROM attachments WHERE uid = ? AND folder = ?`)
  stmt.bind([uid, folder])
  return allRows(stmt)
}

export function markAttachmentDownloaded(id, filePath) {
  const d = getDB()
  d.run(`UPDATE attachments SET downloaded = 1, file_path = ? WHERE id = ?`, [filePath, id])
  scheduleSave()
}
```

- [ ] **Step 5: Add FTS5 search function and replace `searchMessages`**

Replace the existing `searchMessages` export with:

```javascript
export function searchMessages(query) {
  const d = getDB()
  // Try FTS5 first; fall back to LIKE if FTS table not yet populated
  try {
    const ftsQuery = query.trim().split(/\s+/).map(w => `"${w.replace(/"/g, '')}"`).join(' ')
    const stmt = d.prepare(`
      SELECT m.uid, m.folder, m.subject, m.from_name, m.from_email,
             m.date, m.flags, m.snippet, m.has_attachments, m.thread_id
      FROM messages_fts f
      JOIN messages m ON m.uid = f.uid AND m.folder = f.folder
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT 100
    `)
    stmt.bind([ftsQuery])
    const rows = allRows(stmt)
    return rows.map(r => ({ ...r, flags: JSON.parse(r.flags || '[]') }))
  } catch {
    // FTS5 not available or query error — fall back to LIKE
    const like = `%${query}%`
    const stmt = d.prepare(`
      SELECT uid, folder, subject, from_name, from_email, date, flags, snippet, has_attachments, thread_id
      FROM messages
      WHERE subject LIKE ? OR from_name LIKE ? OR from_email LIKE ? OR snippet LIKE ?
      ORDER BY date DESC
      LIMIT 100
    `)
    stmt.bind([like, like, like, like])
    const rows = allRows(stmt)
    return rows.map(r => ({ ...r, flags: JSON.parse(r.flags || '[]') }))
  }
}
```

- [ ] **Step 6: Update `upsertMessage` to maintain FTS5 and accept new columns**

Replace the existing `upsertMessage` function:

```javascript
export function upsertMessage(msg) {
  const d = getDB()
  d.run(`
    INSERT INTO messages
      (uid, folder, account_email, message_id, subject, from_name, from_email,
       to_addresses, cc_addresses, date, flags, snippet, has_attachments, size,
       thread_id, in_reply_to, message_refs)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uid, folder) DO UPDATE SET
      flags           = excluded.flags,
      snippet         = COALESCE(NULLIF(excluded.snippet,''), messages.snippet),
      has_attachments = excluded.has_attachments,
      thread_id       = COALESCE(excluded.thread_id, messages.thread_id),
      in_reply_to     = COALESCE(excluded.in_reply_to, messages.in_reply_to),
      message_refs    = COALESCE(excluded.message_refs, messages.message_refs),
      account_email   = COALESCE(excluded.account_email, messages.account_email)
  `, [
    msg.uid, msg.folder,
    msg.account_email || null,
    msg.message_id || '',
    msg.subject || '', msg.from_name || '', msg.from_email || '',
    JSON.stringify(msg.to_addresses || []),
    JSON.stringify(msg.cc_addresses || []),
    msg.date || Date.now(),
    JSON.stringify(msg.flags || []),
    msg.snippet || '',
    msg.has_attachments ? 1 : 0,
    msg.size || 0,
    msg.thread_id || null,
    msg.in_reply_to || null,
    msg.message_refs || null
  ])
  // Maintain FTS5 index
  try {
    d.run(`
      INSERT OR REPLACE INTO messages_fts(uid, folder, subject, body_text, from_name, from_email)
      VALUES (?, ?, ?, '', ?, ?)
    `, [msg.uid, msg.folder, msg.subject || '', msg.from_name || '', msg.from_email || ''])
  } catch { /* FTS5 insert is best-effort */ }
  scheduleSave()
}
```

- [ ] **Step 7: Update `saveMessageBody` to update FTS5 body_text**

Replace existing `saveMessageBody`:

```javascript
export function saveMessageBody(folder, uid, html, text) {
  const d = getDB()
  d.run(
    `UPDATE messages SET body_html = ?, body_text = ?, body_fetched = 1 WHERE folder = ? AND uid = ?`,
    [html, text, folder, uid]
  )
  // Update FTS5 with full body text
  try {
    d.run(
      `UPDATE messages_fts SET body_text = ? WHERE uid = ? AND folder = ?`,
      [text || '', uid, folder]
    )
  } catch { /* best-effort */ }
  scheduleSave()
}
```

- [ ] **Step 8: Export new helpers from db.js**

Confirm `getSyncState`, `upsertSyncState`, `upsertAccount`, `getAccounts`, `deleteAccount`, `upsertDraft`, `getDrafts`, `deleteDraft`, `upsertAttachmentMeta`, `getAttachmentsMeta`, `markAttachmentDownloaded` are all exported with the `export` keyword.

---

## Task 3: UID-based delta sync in ImapClient

**Files:**
- Modify: `src/main/imap/client.js`

- [ ] **Step 1: Import new db helpers at top of client.js**

Replace the existing import block (lines 1–14) with:

```javascript
import { ImapFlow } from 'imapflow'
import { EventEmitter } from 'events'
import { simpleParser } from 'mailparser'
import {
  upsertMessage,
  upsertFolder,
  updateFolderCounts,
  getFolders,
  getMessages,
  getMessageCount,
  saveMessageBody,
  getMessageBody,
  removeMessages,
  getSyncState,
  upsertSyncState,
  upsertAttachmentMeta
} from '../store/db.js'
```

- [ ] **Step 2: Add thread_id computation helper**

After the `extractSnippet` function (around line 64), add:

```javascript
function computeThreadId(messageId, inReplyTo, references) {
  // Use the oldest message-id in the thread as the canonical thread id
  if (references) {
    const ids = references.trim().split(/\s+/).filter(Boolean)
    if (ids.length > 0) return ids[0]
  }
  if (inReplyTo) return inReplyTo.trim()
  return messageId || null
}
```

- [ ] **Step 3: Rewrite `_syncFolder` to use UID-based delta sync**

Replace the entire `_syncFolder` method (lines 281–321) with:

```javascript
  async _syncFolder(folder, background = false) {
    if (!this.client) return
    const lock = await this.client.getMailboxLock(folder)
    try {
      const status = await this.client.status(folder, { messages: true, unseen: true, uidNext: true })
      const total  = status.messages || 0
      const unseen = status.unseen  || 0
      updateFolderCounts(folder, unseen, total)

      if (total === 0) {
        this.emit('sync-complete', { folder, newCount: 0 })
        return
      }

      const syncState = getSyncState(this.email, folder)
      const lastUid   = syncState?.last_uid || 0
      let   newCount  = 0
      let   maxUid    = lastUid

      if (lastUid === 0) {
        // Cold start: fetch envelopes of the most recent 200 messages by sequence number
        const from  = Math.max(1, total - 199)
        const range = `${from}:*`
        for await (const msg of this.client.fetch(range, {
          envelope: true, flags: true, bodyStructure: true, size: true
        })) {
          this._persistEnvelope(msg, folder)
          if (msg.uid > maxUid) maxUid = msg.uid
          newCount++
        }
      } else {
        // Delta sync: only UIDs we haven't seen yet
        const uids = await this.client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
        if (uids?.length) {
          for await (const msg of this.client.fetch(uids, {
            envelope: true, flags: true, bodyStructure: true, size: true
          }, { uid: true })) {
            this._persistEnvelope(msg, folder)
            if (msg.uid > maxUid) maxUid = msg.uid
            newCount++
          }
        }
      }

      if (maxUid > 0) upsertSyncState(this.email, folder, maxUid, total)
      this.emit('sync-complete', { folder, newCount })
    } finally {
      lock.release()
    }
  }
```

- [ ] **Step 4: Add `_persistEnvelope` helper method**

Add this method to `ImapClient` after `_syncFolder`:

```javascript
  _persistEnvelope(msg, folder) {
    const envelope   = msg.envelope
    const inReplyTo  = envelope.inReplyTo || null
    const references = envelope.references || null
    const messageId  = envelope.messageId || null
    const threadId   = computeThreadId(messageId, inReplyTo, references)
    const snippet    = ''  // populated lazily when body is fetched

    upsertMessage({
      uid:           msg.uid,
      folder,
      account_email: this.email,
      message_id:    messageId,
      subject:       envelope.subject || '(No subject)',
      from_name:     envelope.from?.[0]?.name || envelope.from?.[0]?.address || '',
      from_email:    envelope.from?.[0]?.address || '',
      to_addresses:  parseAddressList(envelope.to),
      cc_addresses:  parseAddressList(envelope.cc),
      date:          envelope.date ? new Date(envelope.date).getTime() : Date.now(),
      flags:         [...(msg.flags || [])],
      snippet,
      has_attachments: this._hasAttachments(msg.bodyStructure),
      size:          msg.size || 0,
      thread_id:     threadId,
      in_reply_to:   inReplyTo,
      message_refs:  references
    })

    // Persist attachment metadata from body structure (no binary yet)
    this._persistAttachmentMeta(msg, folder, messageId)
  }
```

- [ ] **Step 5: Add `_persistAttachmentMeta` helper**

```javascript
  _persistAttachmentMeta(msg, folder, messageId) {
    if (!msg.bodyStructure) return
    this._walkBodyStructure(msg.bodyStructure, folder, msg.uid, messageId, '')
  }

  _walkBodyStructure(node, folder, uid, messageId, partId) {
    if (!node) return
    const isAttachment = node.disposition === 'attachment' ||
      (node.disposition === 'inline' && node.type !== 'text')
    if (isAttachment && node.type !== 'multipart') {
      upsertAttachmentMeta({
        uid,
        folder,
        message_id:   messageId,
        part_id:      partId || '1',
        filename:     node.dispositionParameters?.filename || node.parameters?.name || 'attachment',
        content_type: `${node.type}/${node.subtype}`.toLowerCase(),
        size:         node.size || 0,
        content_id:   node.id || null,
        is_inline:    node.disposition === 'inline' ? 1 : 0
      })
    }
    if (node.childNodes) {
      node.childNodes.forEach((child, i) => {
        this._walkBodyStructure(child, folder, uid, messageId, partId ? `${partId}.${i + 1}` : `${i + 1}`)
      })
    }
  }
```

- [ ] **Step 6: Fix `_fetchNewMessages` to use UIDs (not sequence ranges)**

Replace the `_fetchNewMessages` method (lines 173–215) with:

```javascript
  async _fetchNewMessages(folder, prevCount, newCount) {
    if (!this.client) return
    const lock = await this.client.getMailboxLock(folder)
    let emitCount = 0
    try {
      // Fetch new messages since our last known UID
      const syncState = getSyncState(this.email, folder)
      const lastUid   = syncState?.last_uid || 0
      const uids      = lastUid > 0
        ? await this.client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
        : []

      if (!uids?.length) return

      let maxUid = lastUid
      for await (const msg of this.client.fetch(uids, {
        envelope: true, flags: true, bodyStructure: true, size: true
      }, { uid: true })) {
        this._persistEnvelope(msg, folder)
        if (msg.uid > maxUid) maxUid = msg.uid

        if (!msg.flags?.has('\\Seen')) {
          emitCount++
          this.emit('new-mail', {
            subject:    msg.envelope.subject || '(No subject)',
            from:       msg.envelope.from?.[0]?.name || msg.envelope.from?.[0]?.address || '',
            folder,
            uid:        msg.uid
          })
        }
      }
      if (maxUid > lastUid) upsertSyncState(this.email, folder, maxUid, newCount)
    } finally {
      lock.release()
    }
    if (emitCount > 0) await this._syncFolderCounts(folder)
  }
```

- [ ] **Step 7: Fix IDLE lock teardown in `_startIdle`**

The current `_startIdle` opens a lock but never releases it (the `finally {}` block is empty and the lock reference is in the `try` body). Replace the entire `_startIdle` method:

```javascript
  async _startIdle() {
    try {
      this.idleClient = makeClient(this.email, this.password)
      await this.idleClient.connect()

      this.idleClient.on('exists', async (data) => {
        const { count, prevCount } = data
        if (count > prevCount) {
          await this._fetchNewMessages(this.idleFolder, prevCount, count).catch(console.error)
        }
      })

      this.idleClient.on('flags', async () => {
        await this._syncFolderCounts(this.idleFolder).catch(console.error)
      })

      this.idleClient.on('error', (err) => {
        if (this.connected) console.error('IDLE client error:', err.message)
      })

      const lock = await this.idleClient.getMailboxLock(this.idleFolder)
      this._idleLock = lock  // store reference for teardown

      const keepIdling = async () => {
        while (this.connected) {
          try {
            await this.idleClient.idle()
          } catch (err) {
            if (!this.connected) break
            console.error('IDLE loop error:', err.message)
            await new Promise(r => setTimeout(r, 5000))
          }
        }
        lock.release()
        this._idleLock = null
      }
      keepIdling().catch(console.error)
    } catch (err) {
      console.error('Failed to start IDLE:', err.message)
      this.syncTimer = setInterval(() => this.syncInbox(), 120000)
    }
  }
```

- [ ] **Step 8: Update `disconnect()` to release idle lock**

Replace the `disconnect` method:

```javascript
  async disconnect() {
    this.connected = false
    clearTimeout(this.reconnectTimer)
    clearInterval(this.syncTimer)

    try { this._idleLock?.release() } catch { /* ignore */ }
    try { await this.idleClient?.logout() } catch { /* ignore */ }
    try { await this.client?.logout() } catch { /* ignore */ }

    this._idleLock = null
    this.idleClient = null
    this.client = null
    this.emit('connection-status', 'disconnected')
  }
```

- [ ] **Step 9: Update `fetchBody` to extract and save snippet + update FTS**

In the `fetchBody` method (lines 343–385), after `saveMessageBody(folder, uid, html, text)`, add:

```javascript
    if (parsed) {
      const html   = parsed.html || null
      const text   = parsed.text || null
      const snippet = extractSnippet(text, html)
      saveMessageBody(folder, uid, html, text)
      // Update snippet in messages row for list preview
      if (snippet) {
        const d = (await import('../store/db.js')).getDB?.()
        // Use direct db call to update snippet without circular import
        try {
          const dbModule = await import('../store/db.js')
          dbModule.updateMessageSnippet?.(folder, uid, snippet)
        } catch { /* non-critical */ }
      }
```

Actually, to keep it clean, add an `updateMessageSnippet` export to db.js and call it here. Let me revise:

In `db.js`, add this export (before `closeDB`):

```javascript
export function updateMessageSnippet(folder, uid, snippet) {
  const d = getDB()
  d.run(`UPDATE messages SET snippet = ? WHERE folder = ? AND uid = ? AND snippet = ''`,
    [snippet, folder, uid])
  try {
    d.run(`UPDATE messages_fts SET body_text = ? WHERE uid = ? AND folder = ?`,
      [snippet, uid, folder])
  } catch { /* best-effort */ }
  scheduleSave()
}
```

And in `client.js`, import `updateMessageSnippet` at the top (add to the import list from `../store/db.js`).

Then in `fetchBody`, replace the `saveMessageBody(folder, uid, html, text)` call and what follows with:

```javascript
    if (!parsed) return { html: null, text: null, attachments: [] }

    const html   = parsed.html || null
    const text   = parsed.text || null
    const snippet = extractSnippet(text, html)

    saveMessageBody(folder, uid, html, text)
    if (snippet) updateMessageSnippet(folder, uid, snippet)

    const attachments = (parsed.attachments || []).map(a => ({
      filename: a.filename || 'attachment',
      size:     a.size || 0,
      type:     a.contentType || 'application/octet-stream',
      content:  a.content   // Buffer — needed for Phase 7 download
    }))

    return { html, text, attachments }
```

---

## Task 4: New IPC handlers in main/index.js

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Import new db exports at top of index.js**

Replace the existing db import line (line 3):

```javascript
import {
  initDB, closeDB, searchMessages, getSettings, saveSetting,
  getFolders, clearBodyCache, clearFolderCache, getDbPath, resetAllData,
  getAccounts, upsertAccount, deleteAccount,
  getDrafts, upsertDraft, deleteDraft,
  getSyncState, upsertSyncState
} from './store/db.js'
```

- [ ] **Step 2: Wire `sync-complete` event from imapClient to renderer**

In the `ipcMain.handle('imap:connect', ...)` handler, after the `imapClient.on('unread-count', ...)` registration, add:

```javascript
    imapClient.on('sync-complete', ({ folder, newCount }) => {
      mainWindow?.webContents.send('imap:sync-complete', { folder, newCount })
    })
```

Also add the same in the `app.whenReady()` block (the auto-connect section, around line 519), after the existing event registrations:

```javascript
    imapClient.on('sync-complete', ({ folder, newCount }) => {
      mainWindow?.webContents.send('imap:sync-complete', { folder, newCount })
    })
```

- [ ] **Step 3: Add `imap:sync-folder` handler**

After the existing `imap:sync-inbox` handler (around line 285), add:

```javascript
ipcMain.handle('imap:sync-folder', async (_e, folder) => {
  if (!imapClient) return { ok: false, error: 'Not connected' }
  try {
    await imapClient._syncFolder(folder, false)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 4: Add `store:get-sync-state` handler**

After the existing `store:get-cached-folders` handler, add:

```javascript
ipcMain.handle('store:get-sync-state', async (_e, folder) => {
  try {
    const creds = await getCredentials()
    if (!creds) return { ok: true, state: null }
    const state = getSyncState(creds.email, folder)
    return { ok: true, state }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 5: Add `accounts:*` IPC handlers**

After the settings handlers, add:

```javascript
// ── Accounts IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('accounts:list', async () => {
  try { return { ok: true, accounts: getAccounts() } }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('accounts:save', async (_e, account) => {
  try { upsertAccount(account); return { ok: true } }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('accounts:delete', async (_e, email) => {
  try { deleteAccount(email); return { ok: true } }
  catch (err) { return { ok: false, error: err.message } }
})
```

- [ ] **Step 6: Add `drafts:*` IPC handlers**

```javascript
// ── Drafts IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('drafts:list', async (_e, accountEmail) => {
  try { return { ok: true, drafts: getDrafts(accountEmail) } }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('drafts:save', async (_e, draft) => {
  try {
    const id = upsertDraft(draft)
    return { ok: true, id }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('drafts:delete', async (_e, id) => {
  try { deleteDraft(id); return { ok: true } }
  catch (err) { return { ok: false, error: err.message } }
})
```

---

## Task 5: Preload bridge updates

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Expose new IPC methods on `window.api`**

In `src/preload/index.js`, add the following namespaces inside `contextBridge.exposeInMainWorld('api', { ... })`:

After the `imap` namespace closing brace, add `syncFolder`:

```javascript
    syncFolder: (folder) =>
      ipcRenderer.invoke('imap:sync-folder', folder),
```

After the `store` namespace, add new entries in the store namespace:

```javascript
    getSyncState: (folder) =>
      ipcRenderer.invoke('store:get-sync-state', folder),
```

Add new top-level namespaces before the closing `})`:

```javascript
  // ── Accounts ────────────────────────────────────────────────────────────────
  accounts: {
    list:   ()        => ipcRenderer.invoke('accounts:list'),
    save:   (account) => ipcRenderer.invoke('accounts:save', account),
    delete: (email)   => ipcRenderer.invoke('accounts:delete', email)
  },

  // ── Drafts ──────────────────────────────────────────────────────────────────
  drafts: {
    list:   (accountEmail) => ipcRenderer.invoke('drafts:list', accountEmail),
    save:   (draft)        => ipcRenderer.invoke('drafts:save', draft),
    delete: (id)           => ipcRenderer.invoke('drafts:delete', id)
  },
```

- [ ] **Step 2: Expand allowed push event channels**

In the `api.on` whitelist array, verify `'imap:sync-complete'` is already present (it is, per line 101 of the existing preload). No change needed.

---

## Task 6: Wire sync-complete into AppContext

**Files:**
- Modify: `src/renderer/src/App.jsx`

- [ ] **Step 1: Subscribe to `imap:sync-complete` in App.jsx**

In `App.jsx`, inside the `useEffect` that subscribes to push events (lines 15–36), add a new subscription alongside the existing ones:

```javascript
    const offSync = window.api.on('imap:sync-complete', ({ folder, newCount }) => {
      if (newCount > 0) {
        dispatch({ type: 'SYNC_COMPLETE', payload: { folder, newCount } })
      }
    })
```

And in the cleanup:

```javascript
      offSync?.()
```

- [ ] **Step 2: Add `SYNC_COMPLETE` case to reducer in AppContext.jsx**

In `AppContext.jsx` reducer, after the `NEW_MAIL` case, add:

```javascript
    case 'SYNC_COMPLETE': {
      // If we're viewing the folder that just synced, trigger a refresh
      if (action.payload.folder === state.folders.selected) {
        return { ...state, messages: { ...state.messages, _syncSignal: Date.now() } }
      }
      return state
    }
```

- [ ] **Step 3: React to `_syncSignal` in MessageList.jsx**

In `MessageList.jsx`, the existing effect already handles `_newMailSignal`:

```javascript
useEffect(() => { if (state.messages._newMailSignal) loadMessages(1) }, [state.messages._newMailSignal, loadMessages])
```

Add alongside it:

```javascript
useEffect(() => { if (state.messages._syncSignal) loadMessages(1) }, [state.messages._syncSignal, loadMessages])
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Phase 1 (IDLE push, delta sync, UID-based sync, reconnect, connection pooling per account) — delta sync covered Tasks 3-4; IDLE fix in Task 3.7; connection pooling is Phase 3 (flagged as stop condition — IPC contract change). Phase 2 (accounts, folders, messages, attachments, drafts, sync_state) — all in Tasks 1-2.
- [x] **Placeholder scan:** No TBDs. All code is complete.
- [x] **Type consistency:** `upsertSyncState(email, folder, lastUid, messageCount)` is called consistently in client.js. `upsertAttachmentMeta({uid, folder, ...})` matches `getAttachmentsMeta(uid, folder)`.

**⚠️ Stop condition flagged:** Connection pooling per-account requires changing the IPC contract (adding `accountId` to IMAP calls or a new `accounts:connect-all` handler). This is deferred to Phase 3 plan and requires human sign-off before implementation.

---

## Checkpoint

After all tasks pass: output `✅ Phase 1-2 Foundation — delta sync active, schema v1 migrated, FTS5 index live`
