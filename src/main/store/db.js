import initSqlJs from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

let db = null
let SQL = null
let dbPath = null
let saveTimer = null

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(persistDB, 500)
}

function persistDB() {
  if (!db || !dbPath) return
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

export async function initDB() {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'db')
  mkdirSync(dbDir, { recursive: true })
  dbPath = join(dbDir, 'mail.db')

  // Locate the WASM file (shipped as extraResource)
  const wasmPath = existsSync(join(process.resourcesPath || '', 'sql-wasm.wasm'))
    ? join(process.resourcesPath, 'sql-wasm.wasm')
    : join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')

  SQL = await initSqlJs({
    locateFile: () => wasmPath
  })

  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`PRAGMA foreign_keys = ON`)

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      uid          INTEGER NOT NULL,
      folder       TEXT    NOT NULL,
      message_id   TEXT,
      subject      TEXT,
      from_name    TEXT,
      from_email   TEXT,
      to_addresses TEXT,
      cc_addresses TEXT,
      date         INTEGER,
      flags        TEXT    DEFAULT '[]',
      snippet      TEXT,
      has_attachments INTEGER DEFAULT 0,
      size         INTEGER DEFAULT 0,
      body_html    TEXT,
      body_text    TEXT,
      body_fetched INTEGER DEFAULT 0,
      UNIQUE(uid, folder)
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder, date DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_uid_folder ON messages(uid, folder)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      path         TEXT    UNIQUE NOT NULL,
      name         TEXT,
      delimiter    TEXT,
      unread_count INTEGER DEFAULT 0,
      total_count  INTEGER DEFAULT 0,
      special_use  TEXT,
      flags        TEXT    DEFAULT '[]'
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Default settings
  const defaults = {
    syncMode: 'idle',
    syncInterval: 5,
    blockRemoteImages: true,
    notificationsEnabled: true,
    notifyFolders: ['INBOX'],
    signature: '',
    theme: 'light',
    language: 'en-US'
  }
  for (const [key, value] of Object.entries(defaults)) {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)])
  }

  try {
    _runMigrations(db)
  } catch (err) {
    console.error('DB migration error (non-fatal):', err.message)
  }

  try {
    _migrate2(db)
  } catch (err) {
    console.error('DB migration v2 error (non-fatal):', err.message)
  }

  try {
    _migrate3(db)
  } catch (err) {
    console.error('DB migration v3 error (non-fatal):', err.message)
  }

  persistDB()
  return db
}

function _runMigrations(d) {
  // Read current schema version (default 0 if not yet set)
  let ver = 0
  let stmt
  try {
    stmt = d.prepare(`SELECT value FROM settings WHERE key = 'schemaVersion'`)
    if (stmt.step()) {
      ver = parseInt(JSON.parse(stmt.getAsObject().value), 10) || 0
    }
  } catch { /* settings may not exist yet */ }
  finally { try { stmt?.free() } catch { /* ignore */ } }

  if (ver >= 1) return

  // ── Migration to version 1 ────────────────────────────────────────────────

  // New table: sync_state
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

  // New table: accounts
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

  // New table: drafts
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

  // New table: attachments
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

  // Add new columns to existing messages table (only if not already present)
  const existingCols = new Set()
  let colStmt
  try {
    colStmt = d.prepare(`PRAGMA table_info(messages)`)
    while (colStmt.step()) {
      const col = colStmt.getAsObject()
      if (col?.name) existingCols.add(col.name)
    }
  } finally {
    try { colStmt?.free() } catch { /* ignore */ }
  }

  if (!existingCols.has('account_email')) {
    d.run(`ALTER TABLE messages ADD COLUMN account_email TEXT`)
  }
  if (!existingCols.has('thread_id')) {
    d.run(`ALTER TABLE messages ADD COLUMN thread_id TEXT`)
  }
  if (!existingCols.has('in_reply_to')) {
    d.run(`ALTER TABLE messages ADD COLUMN in_reply_to TEXT`)
  }
  if (!existingCols.has('message_refs')) {
    d.run(`ALTER TABLE messages ADD COLUMN message_refs TEXT`)
  }

  d.run(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`)

  // FTS5 — best-effort; WASM may not have FTS5 compiled in
  try {
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

    // Only back-fill if not already done (prevents duplicates on retry)
    const ftsSeeded = (() => {
      try {
        const s = d.prepare(`SELECT value FROM settings WHERE key = 'fts_seeded'`)
        const has = s.step() && s.getAsObject().value === '"1"'
        s.free()
        return has
      } catch { return false }
    })()

    if (!ftsSeeded) {
      d.run(`
        INSERT INTO messages_fts(uid, folder, subject, body_text, from_name, from_email)
        SELECT uid, folder,
               COALESCE(subject,''),
               COALESCE(body_text,''),
               COALESCE(from_name,''),
               COALESCE(from_email,'')
        FROM messages
      `)
      d.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('fts_seeded', '1')`)
    }
  } catch (err) {
    console.warn('FTS5 not available or error:', err.message)
  }

  // Mark migration as complete
  d.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('schemaVersion', '1')`)
}

function _migrate2(d) {
  let ver = 0
  try {
    const s = d.prepare(`SELECT value FROM settings WHERE key = 'schemaVersion'`)
    if (s.step()) ver = parseInt(JSON.parse(s.getAsObject().value), 10) || 0
    s.free()
  } catch { /* ignore */ }
  if (ver >= 2) return

  d.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id            TEXT PRIMARY KEY,
      account_email TEXT,
      display_name  TEXT,
      first_name    TEXT,
      last_name     TEXT,
      email         TEXT,
      emails        TEXT DEFAULT '[]',
      phone         TEXT,
      phones        TEXT DEFAULT '[]',
      organization  TEXT,
      title         TEXT,
      notes         TEXT,
      etag          TEXT,
      href          TEXT,
      vcard         TEXT,
      source        TEXT DEFAULT 'carddav',
      updated_at    INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)
  d.run(`CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)`)
  d.run(`CREATE INDEX IF NOT EXISTS idx_contacts_name  ON contacts(display_name)`)
  d.run(`CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_email)`)

  d.run(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id            TEXT PRIMARY KEY,
      account_email TEXT,
      calendar_id   TEXT,
      title         TEXT,
      description   TEXT,
      location      TEXT,
      start_ts      INTEGER,
      end_ts        INTEGER,
      all_day       INTEGER DEFAULT 0,
      rrule         TEXT,
      status        TEXT DEFAULT 'CONFIRMED',
      organizer     TEXT,
      attendees     TEXT DEFAULT '[]',
      etag          TEXT,
      href          TEXT,
      updated_at    INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)
  d.run(`CREATE INDEX IF NOT EXISTS idx_events_start   ON calendar_events(start_ts)`)
  d.run(`CREATE INDEX IF NOT EXISTS idx_events_account ON calendar_events(account_email)`)

  d.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('schemaVersion', '2')`)
}

function _migrate3(d) {
  let ver = 0
  try {
    const s = d.prepare(`SELECT value FROM settings WHERE key = 'schemaVersion'`)
    if (s.step()) ver = parseInt(JSON.parse(s.getAsObject().value), 10) || 0
    s.free()
  } catch { /* ignore */ }
  if (ver >= 3) return

  try { d.run(`ALTER TABLE contacts ADD COLUMN birthday TEXT`) } catch { /* already exists */ }
  try { d.run(`ALTER TABLE contacts ADD COLUMN photo_url TEXT`) } catch { /* already exists */ }
  try { d.run(`ALTER TABLE contacts ADD COLUMN social_profiles TEXT DEFAULT '[]'`) } catch { /* already exists */ }

  d.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('schemaVersion', '3')`)
}

function getDB() {
  if (!db) throw new Error('DB not initialized — call initDB() first')
  return db
}

function allRows(stmt) {
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function oneRow(stmt) {
  let row = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
  return row
}

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
  try {
    // INSERT OR IGNORE so we don't overwrite body_text from a previous fetchBody
    d.run(`
      INSERT OR IGNORE INTO messages_fts(uid, folder, subject, body_text, from_name, from_email)
      VALUES (?, ?, ?, '', ?, ?)
    `, [msg.uid, msg.folder, msg.subject || '', msg.from_name || '', msg.from_email || ''])
    // Then update the header fields (but not body_text) in case subject/sender changed
    d.run(`
      UPDATE messages_fts SET subject = ?, from_name = ?, from_email = ?
      WHERE uid = ? AND folder = ?
    `, [msg.subject || '', msg.from_name || '', msg.from_email || '', msg.uid, msg.folder])
  } catch { /* FTS5 best-effort */ }
  scheduleSave()
}

export function saveMessageBody(folder, uid, html, text) {
  const d = getDB()
  d.run(
    `UPDATE messages SET body_html = ?, body_text = ?, body_fetched = 1 WHERE folder = ? AND uid = ?`,
    [html, text, folder, uid]
  )
  try {
    d.run(
      `UPDATE messages_fts SET body_text = ? WHERE uid = ? AND folder = ?`,
      [text || '', uid, folder]
    )
  } catch { /* FTS5 best-effort */ }
  scheduleSave()
}

export function getMessageBody(folder, uid) {
  const d = getDB()
  const stmt = d.prepare(
    `SELECT body_html, body_text, body_fetched FROM messages WHERE folder = ? AND uid = ?`
  )
  stmt.bind([folder, uid])
  return oneRow(stmt)
}

export function getMessages(folder, limit, offset) {
  const d = getDB()
  const stmt = d.prepare(`
    SELECT uid, folder, message_id, subject, from_name, from_email,
           to_addresses, cc_addresses, date, flags, snippet, has_attachments, size
    FROM messages
    WHERE folder = ?
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `)
  stmt.bind([folder, limit, offset])
  const rows = allRows(stmt)
  return rows.map(r => ({
    ...r,
    flags: JSON.parse(r.flags || '[]'),
    to_addresses: JSON.parse(r.to_addresses || '[]'),
    cc_addresses: JSON.parse(r.cc_addresses || '[]'),
    has_attachments: r.has_attachments === 1
  }))
}

export function getMessageCount(folder) {
  const d = getDB()
  const stmt = d.prepare(`SELECT COUNT(*) as count FROM messages WHERE folder = ?`)
  stmt.bind([folder])
  const row = oneRow(stmt)
  return row?.count || 0
}

export function upsertFolder(folder) {
  const d = getDB()
  d.run(`
    INSERT INTO folders (path, name, delimiter, special_use, flags, unread_count, total_count)
    VALUES (?,?,?,?,?,0,0)
    ON CONFLICT(path) DO UPDATE SET
      name         = excluded.name,
      special_use  = COALESCE(excluded.special_use, folders.special_use)
  `, [
    folder.path, folder.name, folder.delimiter,
    folder.special_use || null,
    JSON.stringify(folder.flags || [])
  ])
  scheduleSave()
}

export function updateFolderCounts(path, unread, total) {
  const d = getDB()
  d.run(`UPDATE folders SET unread_count = ?, total_count = ? WHERE path = ?`, [unread, total, path])
  scheduleSave()
}

export function getFolders() {
  const d = getDB()
  const stmt = d.prepare(`SELECT * FROM folders ORDER BY special_use DESC, path ASC`)
  const rows = allRows(stmt)
  return rows.map(f => ({
    ...f,
    flags: JSON.parse(f.flags || '[]')
  }))
}

export function searchMessages(query) {
  if (!query?.trim()) return []
  const d = getDB()
  try {
    const ftsQuery = query.trim().split(/\s+/)
      .filter(Boolean)
      .map(w => `"${w.replace(/"/g, '')}"`)
      .join(' ')
    const stmt = d.prepare(`
      SELECT m.uid, m.folder, m.subject, m.from_name, m.from_email,
             m.date, m.flags, m.snippet, m.has_attachments, m.thread_id
      FROM messages_fts f
      JOIN messages m ON m.uid = CAST(f.uid AS INTEGER) AND m.folder = f.folder
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT 100
    `)
    stmt.bind([ftsQuery])
    const rows = allRows(stmt)
    return rows.map(r => ({ ...r, flags: JSON.parse(r.flags || '[]') }))
  } catch {
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

export function getSettings() {
  const d = getDB()
  const stmt = d.prepare(`SELECT key, value FROM settings`)
  const rows = allRows(stmt)
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]))
}

export function saveSetting(key, value) {
  const d = getDB()
  d.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)])
  scheduleSave()
}

export function getLocalUids(folder) {
  const d = getDB()
  const stmt = d.prepare(`SELECT uid FROM messages WHERE folder = ?`)
  stmt.bind([folder])
  const uids = []
  while (stmt.step()) uids.push(stmt.getAsObject().uid)
  stmt.free()
  return uids
}

export function updateMessageFlags(folder, uid, flags) {
  const d = getDB()
  d.run(`UPDATE messages SET flags = ? WHERE folder = ? AND uid = ?`,
    [JSON.stringify(flags), folder, uid])
  scheduleSave()
}

export function toggleMessageFlag(folder, uid, flag, add) {
  const d = getDB()
  const stmt = d.prepare(`SELECT flags FROM messages WHERE folder = ? AND uid = ?`)
  stmt.bind([folder, uid])
  let flags = []
  if (stmt.step()) {
    try { flags = JSON.parse(stmt.getAsObject().flags || '[]') } catch {}
  }
  stmt.free()
  const updated = add
    ? [...new Set([...flags, flag])]
    : flags.filter(f => f !== flag)
  d.run(`UPDATE messages SET flags = ? WHERE folder = ? AND uid = ?`,
    [JSON.stringify(updated), folder, uid])
  scheduleSave()
}

export function removeMessages(uids, folder) {
  if (!uids?.length) return
  const d = getDB()
  const placeholders = uids.map(() => '?').join(',')
  d.run(`DELETE FROM messages WHERE folder = ? AND uid IN (${placeholders})`, [folder, ...uids])
  scheduleSave()
}

export function clearBodyCache() {
  const d = getDB()
  d.run(`UPDATE messages SET body_html = NULL, body_text = NULL, body_fetched = 0`)
  scheduleSave()
}

export function clearFolderCache() {
  const d = getDB()
  d.run(`DELETE FROM folders`)
  scheduleSave()
}

export function getDbPath() {
  return dbPath
}

export function resetAllData() {
  const d = getDB()
  d.run(`DELETE FROM messages`)
  d.run(`DELETE FROM folders`)
  d.run(`DELETE FROM settings`)
  d.run(`DELETE FROM accounts`)
  d.run(`DELETE FROM sync_state`)
  d.run(`DELETE FROM drafts`)
  d.run(`DELETE FROM attachments`)
  d.run(`DELETE FROM contacts`)
  d.run(`DELETE FROM calendar_events`)
  try { d.run(`DELETE FROM messages_fts`) } catch { /* FTS5 best-effort */ }
  scheduleSave()
}

// Graceful shutdown — ensure pending writes are flushed
export function closeDB() {
  clearTimeout(saveTimer)
  persistDB()
  db?.close()
  db = null
}

// ── sync_state helpers ────────────────────────────────────────────────────────

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

// ── draft helpers ─────────────────────────────────────────────────────────────

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
  const rows = d.exec(`SELECT last_insert_rowid() as id`)
  return rows[0]?.values?.[0]?.[0] || null
}

export function getDrafts(accountEmail) {
  const d = getDB()
  if (!accountEmail) {
    return allRows(d.prepare(`SELECT * FROM drafts ORDER BY updated_at DESC`))
      .map(r => ({ ...r, attachments: JSON.parse(r.attachments || '[]') }))
  }
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

// ── attachment metadata helpers ───────────────────────────────────────────────

export function upsertAttachmentMeta(att) {
  const d = getDB()
  const partId = att.part_id || null
  d.run(`
    UPDATE attachments SET
      filename = ?, content_type = ?, size = ?, content_id = ?, is_inline = ?
    WHERE uid = ? AND folder = ? AND (part_id = ? OR (part_id IS NULL AND ? IS NULL))
  `, [
    att.filename || 'attachment',
    att.content_type || 'application/octet-stream',
    att.size || 0,
    att.content_id || null,
    att.is_inline ? 1 : 0,
    att.uid, att.folder,
    partId, partId
  ])
  const changed = d.exec(`SELECT changes()`)[0]?.values?.[0]?.[0] || 0
  if (changed === 0) {
    d.run(`
      INSERT INTO attachments
        (uid, folder, message_id, part_id, filename, content_type, size, content_id, is_inline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      att.uid, att.folder, att.message_id || null,
      partId, att.filename || 'attachment',
      att.content_type || 'application/octet-stream', att.size || 0,
      att.content_id || null, att.is_inline ? 1 : 0
    ])
  }
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

// ── snippet / FTS helpers ─────────────────────────────────────────────────────

export function updateMessageSnippet(folder, uid, snippet) {
  const d = getDB()
  d.run(
    `UPDATE messages SET snippet = ? WHERE folder = ? AND uid = ? AND (snippet IS NULL OR snippet = '')`,
    [snippet, folder, uid]
  )
  try {
    d.run(
      `UPDATE messages_fts SET body_text = ? WHERE uid = ? AND folder = ? AND body_text = ''`,
      [snippet, uid, folder]
    )
  } catch { /* FTS5 best-effort */ }
  scheduleSave()
}

// ── contacts helpers ──────────────────────────────────────────────────────────

export function upsertContact(contact) {
  const d = getDB()
  d.run(`
    INSERT INTO contacts
      (id, account_email, display_name, first_name, last_name, email, emails,
       phone, phones, organization, title, notes, birthday, photo_url, social_profiles,
       etag, href, vcard, source, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      display_name    = excluded.display_name,
      first_name      = excluded.first_name,
      last_name       = excluded.last_name,
      email           = excluded.email,
      emails          = excluded.emails,
      phone           = excluded.phone,
      phones          = excluded.phones,
      organization    = excluded.organization,
      title           = excluded.title,
      notes           = excluded.notes,
      birthday        = excluded.birthday,
      photo_url       = excluded.photo_url,
      social_profiles = excluded.social_profiles,
      etag            = excluded.etag,
      href            = excluded.href,
      vcard           = excluded.vcard,
      source          = excluded.source,
      updated_at      = excluded.updated_at
  `, [
    contact.id, contact.account_email || null,
    contact.display_name || '', contact.first_name || '', contact.last_name || '',
    contact.email || '', JSON.stringify(contact.emails || []),
    contact.phone || '', JSON.stringify(contact.phones || []),
    contact.organization || null, contact.title || null, contact.notes || null,
    contact.birthday || null, contact.photo_url || null,
    JSON.stringify(contact.social_profiles || []),
    contact.etag || null, contact.href || null, contact.vcard || null,
    contact.source || 'carddav', Date.now()
  ])
  scheduleSave()
}

function _hydrateContact(r) {
  return {
    ...r,
    emails:          JSON.parse(r.emails          || '[]'),
    phones:          JSON.parse(r.phones          || '[]'),
    social_profiles: JSON.parse(r.social_profiles || '[]'),
  }
}

export function getContacts(accountEmail) {
  const d = getDB()
  const stmt = accountEmail
    ? d.prepare(`SELECT * FROM contacts WHERE account_email = ? OR account_email IS NULL ORDER BY display_name ASC`)
    : d.prepare(`SELECT * FROM contacts ORDER BY display_name ASC`)
  if (accountEmail) stmt.bind([accountEmail])
  const rows = allRows(stmt)
  return rows.map(r => _hydrateContact(r))
}

export function searchContacts(query, accountEmail) {
  const d = getDB()
  const q = `%${query}%`
  const stmt = d.prepare(`
    SELECT * FROM contacts
    WHERE (display_name LIKE ? OR email LIKE ? OR organization LIKE ?)
      ${accountEmail ? 'AND (account_email = ? OR account_email IS NULL)' : ''}
    ORDER BY display_name ASC
    LIMIT 20
  `)
  const params = accountEmail ? [q, q, q, accountEmail] : [q, q, q]
  stmt.bind(params)
  const rows = allRows(stmt)
  return rows.map(r => _hydrateContact(r))
}

export function deleteContacts(accountEmail) {
  const d = getDB()
  d.run(`DELETE FROM contacts WHERE account_email = ? AND source = 'carddav'`, [accountEmail])
  scheduleSave()
}

export function deleteContact(id) {
  const d = getDB()
  d.run(`DELETE FROM contacts WHERE id = ?`, [id])
  scheduleSave()
}

// ── calendar helpers ──────────────────────────────────────────────────────────

export function upsertEvent(event) {
  const d = getDB()
  d.run(`
    INSERT INTO calendar_events
      (id, account_email, calendar_id, title, description, location,
       start_ts, end_ts, all_day, rrule, status, organizer, attendees, etag, href, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      title        = excluded.title,
      description  = excluded.description,
      location     = excluded.location,
      start_ts     = excluded.start_ts,
      end_ts       = excluded.end_ts,
      all_day      = excluded.all_day,
      rrule        = excluded.rrule,
      status       = excluded.status,
      organizer    = excluded.organizer,
      attendees    = excluded.attendees,
      etag         = excluded.etag,
      href         = excluded.href,
      updated_at   = excluded.updated_at
  `, [
    event.id, event.account_email || null, event.calendar_id || null,
    event.title || '', event.description || null, event.location || null,
    event.start_ts || 0, event.end_ts || 0, event.all_day ? 1 : 0,
    event.rrule || null, event.status || 'CONFIRMED',
    event.organizer || null, JSON.stringify(event.attendees || []),
    event.etag || null, event.href || null, Date.now()
  ])
  scheduleSave()
}

export function getEvents(accountEmail, fromTs, toTs) {
  const d = getDB()
  const from = fromTs || Date.now() - 86400000 * 7
  const to = toTs || Date.now() + 86400000 * 90
  const stmt = accountEmail
    ? d.prepare(`SELECT * FROM calendar_events WHERE (account_email = ? OR account_email IS NULL) AND start_ts >= ? AND start_ts <= ? ORDER BY start_ts ASC`)
    : d.prepare(`SELECT * FROM calendar_events WHERE start_ts >= ? AND start_ts <= ? ORDER BY start_ts ASC`)
  if (accountEmail) stmt.bind([accountEmail, from, to])
  else stmt.bind([from, to])
  const rows = allRows(stmt)
  return rows.map(r => ({ ...r, attendees: JSON.parse(r.attendees || '[]') }))
}

export function deleteEvents(accountEmail, calendarId) {
  const d = getDB()
  if (calendarId) {
    d.run(`DELETE FROM calendar_events WHERE account_email = ? AND calendar_id = ?`, [accountEmail, calendarId])
  } else {
    d.run(`DELETE FROM calendar_events WHERE account_email = ?`, [accountEmail])
  }
  scheduleSave()
}
