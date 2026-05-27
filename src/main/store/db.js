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
    language: 'en'
  }
  for (const [key, value] of Object.entries(defaults)) {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)])
  }

  persistDB()
  return db
}

function getDB() {
  if (!db) throw new Error('DB not initialized — call initDB() first')
  return db
}

function allRows(stmt, params = []) {
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function oneRow(stmt, params = []) {
  let row = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
  return row
}

export function upsertMessage(msg) {
  const d = getDB()
  d.run(`
    INSERT INTO messages
      (uid, folder, message_id, subject, from_name, from_email, to_addresses,
       cc_addresses, date, flags, snippet, has_attachments, size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uid, folder) DO UPDATE SET
      flags           = excluded.flags,
      snippet         = COALESCE(excluded.snippet, messages.snippet),
      has_attachments = excluded.has_attachments
  `, [
    msg.uid, msg.folder, msg.message_id || '',
    msg.subject || '', msg.from_name || '', msg.from_email || '',
    JSON.stringify(msg.to_addresses || []),
    JSON.stringify(msg.cc_addresses || []),
    msg.date || Date.now(),
    JSON.stringify(msg.flags || []),
    msg.snippet || '',
    msg.has_attachments ? 1 : 0,
    msg.size || 0
  ])
  scheduleSave()
}

export function saveMessageBody(folder, uid, html, text) {
  const d = getDB()
  d.run(
    `UPDATE messages SET body_html = ?, body_text = ?, body_fetched = 1 WHERE folder = ? AND uid = ?`,
    [html, text, folder, uid]
  )
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
  const d = getDB()
  const like = `%${query}%`
  const stmt = d.prepare(`
    SELECT uid, folder, subject, from_name, from_email, date, flags, snippet
    FROM messages
    WHERE subject LIKE ? OR from_name LIKE ? OR from_email LIKE ? OR snippet LIKE ?
    ORDER BY date DESC
    LIMIT 100
  `)
  stmt.bind([like, like, like, like])
  const rows = allRows(stmt)
  return rows.map(r => ({ ...r, flags: JSON.parse(r.flags || '[]') }))
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
  scheduleSave()
}

// Graceful shutdown — ensure pending writes are flushed
export function closeDB() {
  clearTimeout(saveTimer)
  persistDB()
  db?.close()
  db = null
}
