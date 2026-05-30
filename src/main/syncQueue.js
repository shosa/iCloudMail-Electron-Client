import { getDB } from './store/db.js'
import { logSync, logErr } from './logger.js'
import { BrowserWindow } from 'electron'

// Sync queue operations for offline-first architecture
// Maintains a persistent ordered queue of pending IMAP/SMTP operations

export function enqueueSyncOperation(operation, targetType, data, options = {}) {
  const d = getDB()
  const {
    accountEmail,
    folder,
    uid,
    targetId
  } = options

  d.run(`
    INSERT INTO sync_queue (operation, target_type, target_id, data, account_email, folder, uid)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    operation,
    targetType,
    targetId || null,
    JSON.stringify(data),
    accountEmail || null,
    folder || null,
    uid || null
  ])

  logSync(`[SyncQueue] Enqueued ${operation} for ${targetType}`)

  // Notify renderer that a sync operation started
  const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
  if (mainWindow) {
    mainWindow.webContents.send('sync:operation-start')
  }
}

export function dequeuePendingOperations() {
  const d = getDB()
  const stmt = d.prepare(`
    SELECT * FROM sync_queue
    ORDER BY created_at ASC
    LIMIT 50
  `)
  const operations = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    operations.push({
      ...row,
      data: JSON.parse(row.data)
    })
  }
  stmt.free()
  return operations
}

export function markSyncOperationCompleted(id) {
  const d = getDB()
  d.run(`DELETE FROM sync_queue WHERE id = ?`, [id])

  // Notify renderer that a sync operation completed
  const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
  if (mainWindow) {
    mainWindow.webContents.send('sync:operation-end')
  }
}

export function markSyncOperationFailed(id, error) {
  const d = getDB()
  d.run(`
    UPDATE sync_queue
    SET retry_count = retry_count + 1, last_error = ?
    WHERE id = ?
  `, [error, id])
}

export function clearFailedOperations() {
  const d = getDB()
  d.run(`DELETE FROM sync_queue WHERE retry_count >= 3`)
}

// Outbox operations for optimistic email sending
export function addToOutbox(emailData) {
  const d = getDB()
  d.run(`
    INSERT INTO outbox
    (account_email, to_field, cc_field, bcc_field, subject, body_html, body_text, attachments, in_reply_to, message_refs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    emailData.accountEmail,
    emailData.to,
    emailData.cc || null,
    emailData.bcc || null,
    emailData.subject,
    emailData.html || null,
    emailData.text || null,
    JSON.stringify(emailData.attachments || []),
    emailData.inReplyTo || null,
    emailData.references || null
  ])

  const result = d.exec(`SELECT last_insert_rowid() as id`)
  const id = result[0]?.values?.[0]?.[0]
  logSync(`[Outbox] Added email to outbox: ${id}`)

  // Notify renderer that a send operation started
  const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
  if (mainWindow) {
    mainWindow.webContents.send('sync:operation-start')
  }

  return id
}

export function getPendingOutboxEmails(accountEmail) {
  const d = getDB()
  const stmt = d.prepare(`
    SELECT * FROM outbox
    WHERE account_email = ? AND sync_status = 'pending'
    ORDER BY created_at ASC
  `)
  stmt.bind([accountEmail])
  const emails = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    emails.push({
      ...row,
      attachments: JSON.parse(row.attachments || '[]')
    })
  }
  stmt.free()
  return emails
}

export function markOutboxEmailSent(id) {
  const d = getDB()
  d.run(`
    UPDATE outbox
    SET sync_status = 'sent', sent_at = strftime('%s','now') * 1000
    WHERE id = ?
  `, [id])

  // Notify renderer that a send operation completed
  const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
  if (mainWindow) {
    mainWindow.webContents.send('sync:operation-end')
  }
}

export function markOutboxEmailFailed(id, error) {
  const d = getDB()
  d.run(`
    UPDATE outbox
    SET sync_status = 'error', error_message = ?
    WHERE id = ?
  `, [error, id])

  // Notify renderer that a send operation ended (failed)
  const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
  if (mainWindow) {
    mainWindow.webContents.send('sync:operation-end')
  }
}

// Optimistic local operations
export function updateMessageOptimistic(folder, uid, updates) {
  const d = getDB()
  const setClauses = []
  const values = []

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = ?`)
    if (key === 'flags') {
      values.push(JSON.stringify(value))
    } else {
      values.push(value)
    }
  }

  // Always mark as pending sync when making optimistic updates
  setClauses.push('sync_status = ?')
  values.push('pending')

  values.push(folder, uid)

  d.run(`
    UPDATE messages
    SET ${setClauses.join(', ')}
    WHERE folder = ? AND uid = ?
  `, values)
}

export function rollbackOptimisticUpdate(folder, uid, originalData) {
  const d = getDB()
  const setClauses = []
  const values = []

  for (const [key, value] of Object.entries(originalData)) {
    setClauses.push(`${key} = ?`)
    if (key === 'flags') {
      values.push(JSON.stringify(value))
    } else {
      values.push(value)
    }
  }

  // Restore sync status to synced
  setClauses.push('sync_status = ?')
  values.push('synced')

  values.push(folder, uid)

  d.run(`
    UPDATE messages
    SET ${setClauses.join(', ')}
    WHERE folder = ? AND uid = ?
  `, values)

  logErr(`[SyncQueue] Rolled back optimistic update for message ${uid} in ${folder}`)
}