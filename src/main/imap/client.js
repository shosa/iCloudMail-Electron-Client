import { ImapFlow } from 'imapflow'
import { EventEmitter } from 'events'
import { simpleParser } from 'mailparser'
import { logSync, logMail, logMove, logDelete, logInfo, logWarn, logErr } from '../logger.js'
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
  getLocalUids,
  updateMessageFlags,
  toggleMessageFlag,
  getSyncState,
  upsertSyncState,
  upsertAttachmentMeta,
  updateMessageSnippet
} from '../store/db.js'

const IMAP_HOST = 'imap.mail.me.com'
const IMAP_PORT = 993

const SPECIAL_USE_MAP = {
  '\\Inbox': 'INBOX',
  '\\Sent': 'Sent',
  '\\Drafts': 'Drafts',
  '\\Trash': 'Deleted Messages',
  '\\Junk': 'Junk',
  '\\Archive': 'Archive'
}

function makeClient(email, password) {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }
  })
}

function parseAddress(addr) {
  if (!addr) return ''
  if (typeof addr === 'string') return addr
  if (addr.text) return addr.text
  if (Array.isArray(addr)) return addr.map(a => a.text || a.address || '').join(', ')
  return addr.address || ''
}

function parseAddressList(addr) {
  if (!addr) return []
  const list = Array.isArray(addr) ? addr : [addr]
  return list.map(a => ({ name: a.name || '', email: a.address || '' }))
}

function extractSnippet(text, html) {
  if (text) return text.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  }
  return ''
}

function computeThreadId(messageId, inReplyTo, references) {
  if (references) {
    const ids = references.trim().split(/\s+/).filter(Boolean)
    if (ids.length > 0) return ids[0]
  }
  if (inReplyTo) return inReplyTo.trim()
  return messageId || null
}

export class ImapClient extends EventEmitter {
  constructor(email, password) {
    super()
    this.email = email
    this.password = password
    this.client = null
    this.idleClient = null
    this.connected = false
    this.reconnectTimer = null
    this.reconnectDelay = 5000
    this.idleFolder = 'INBOX'
    this.syncTimer = null
    this._idleLock = null
    this._syncInFlight = new Map()  // folder → Promise (dedup concurrent syncs)
    this._lastSyncTime = new Map()  // folder → timestamp
  }

  // ── Connection ────────────────────────────────────────────────────────────

  async connect() {
    logInfo(`Connessione IMAP per ${this.email}…`)
    this.emit('connection-status', 'connecting')
    this.client = makeClient(this.email, this.password)

    this.client.on('error', (err) => {
      logErr(`IMAP error: ${err.message}`)
      this._scheduleReconnect()
    })

    await this.client.connect()
    this.connected = true
    this.reconnectDelay = 5000
    logInfo(`IMAP connesso — ${this.email}`)
    this.emit('connection-status', 'connected')

    await this._syncFolders()
    await this._syncFolder('INBOX', true)
    await this._startIdle()
  }

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

  _scheduleReconnect() {
    if (!this.connected) return
    this.emit('connection-status', 'reconnecting')
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch (err) {
        console.error('Reconnect failed:', err.message)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000)
        this._scheduleReconnect()
      }
    }, this.reconnectDelay)
  }

  // ── IDLE (push) ───────────────────────────────────────────────────────────

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

      this.idleClient.on('expunge', () => {
        // Debounce multiple rapid expunges into a single reconciliation sync
        clearTimeout(this._expungeTimer)
        this._expungeTimer = setTimeout(async () => {
          await this._syncFolder(this.idleFolder, true).catch(console.error)
        }, 800)
      })

      this.idleClient.on('flags', async (data) => {
        await this._syncFolderCounts(this.idleFolder).catch(console.error)
        // Update specific message flags if the event carries uid/flags info
        if (data?.uid) {
          const flags = data.flags
            ? (Array.isArray(data.flags) ? data.flags : [...(data.flags || [])])
            : null
          if (flags) {
            updateMessageFlags(this.idleFolder, data.uid, flags)
            this.emit('flags-updated', { folder: this.idleFolder, uid: data.uid, flags })
          }
        }
      })

      this.idleClient.on('error', (err) => {
        if (this.connected) console.error('IDLE client error:', err.message)
      })

      const lock = await this.idleClient.getMailboxLock(this.idleFolder)
      this._idleLock = lock

      const keepIdling = async () => {
        while (this.connected) {
          try {
            await this.idleClient.idle()
          } catch (err) {
            if (!this.connected) break
            console.error('IDLE loop error:', err.message)
            await new Promise(r => setTimeout(r, 5000))
            if (!this.connected || !this.idleClient?.usable) break
          }
        }
        lock.release()
        this._idleLock = null
        if (this.connected) this._scheduleReconnect()
      }
      keepIdling().catch(console.error)
    } catch (err) {
      console.error('Failed to start IDLE:', err.message)
      this.syncTimer = setInterval(() => this.syncInbox(), 120000)
    }
  }

  async _fetchNewMessages(folder, prevCount, newCount) {
    if (!this.client) return
    logMail(`IDLE: ${newCount - prevCount} nuovi messaggi in "${folder}"`)
    const lock = await this.client.getMailboxLock(folder)
    try {
      const syncState = getSyncState(this.email, folder)
      const lastUid   = syncState?.last_uid || 0
      const uids      = lastUid > 0
        ? await this.client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
        : []

      if (!uids?.length) return

      let maxUid = lastUid
      let fetched = 0
      for await (const msg of this.client.fetch(uids, {
        envelope: true, flags: true, bodyStructure: true, size: true
      }, { uid: true })) {
        this._persistEnvelope(msg, folder)
        if (msg.uid > maxUid) maxUid = msg.uid
        fetched++

        if (!msg.flags?.has('\\Seen')) {
          this.emit('new-mail', {
            subject: msg.envelope.subject || '(No subject)',
            from:    msg.envelope.from?.[0]?.name || msg.envelope.from?.[0]?.address || '',
            folder,
            uid:     msg.uid
          })
        }
      }
      if (fetched) logMail(`IDLE: scaricate ${fetched} email da "${folder}"`)
      if (maxUid > lastUid) upsertSyncState(this.email, folder, maxUid, newCount)
    } finally {
      lock.release()
    }
    await this._syncFolderCounts(folder)
  }

  // ── Folder management ─────────────────────────────────────────────────────

  async _syncFolders() {
    const tree = await this.client.listTree()
    this._walkFolderTree(tree.folders)
  }

  _walkFolderTree(folders) {
    for (const f of folders || []) {
      const specialUse = f.specialUse || this._guessSpecialUse(f.path)
      upsertFolder({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter,
        special_use: specialUse,
        flags: [...(f.flags || [])],
        unread_count: 0,
        total_count: 0
      })
      if (f.folders?.length) this._walkFolderTree(f.folders)
    }
  }

  _guessSpecialUse(path) {
    const p = path.toLowerCase()
    if (p === 'inbox') return '\\Inbox'
    if (p.includes('sent')) return '\\Sent'
    if (p.includes('draft')) return '\\Drafts'
    if (p.includes('trash') || p.includes('deleted')) return '\\Trash'
    if (p.includes('junk') || p.includes('spam')) return '\\Junk'
    if (p.includes('archive')) return '\\Archive'
    return null
  }

  async getFolders() {
    await this._syncFolders()
    const folders = getFolders()
    // Update unread counts for known folders
    for (const f of folders) {
      try {
        await this._syncFolderCounts(f.path)
      } catch { /* non-selectable folder */ }
    }
    return getFolders()
  }

  async _syncFolderCounts(folder) {
    if (!this.client) return
    const lock = await this.client.getMailboxLock(folder)
    try {
      const status = await this.client.status(folder, { messages: true, unseen: true })
      updateFolderCounts(folder, status.unseen || 0, status.messages || 0)
      if (folder === 'INBOX') {
        this.emit('unread-count', status.unseen || 0)
      }
    } catch (err) {
      console.warn(`Could not get status for ${folder}:`, err.message)
    } finally {
      lock.release()
    }
  }

  // ── Message fetching ──────────────────────────────────────────────────────

  _syncFolder(folder, background = false) {
    if (!this.client) return Promise.resolve()
    if (this._syncInFlight.has(folder)) return this._syncInFlight.get(folder)
    const p = this._doSyncFolder(folder, background)
    this._syncInFlight.set(folder, p)
    p.finally(() => this._syncInFlight.delete(folder))
    return p
  }

  async _doSyncFolder(folder, background = false) {
    if (!this.client) return
    logSync(`Inizio sync cartella "${folder}"`)
    const lock = await this.client.getMailboxLock(folder)
    try {
      const status = await this.client.status(folder, { messages: true, unseen: true })
      const total  = status.messages || 0
      const unseen = status.unseen  || 0
      updateFolderCounts(folder, unseen, total)
      logSync(`"${folder}": ${total} email totali, ${unseen} non lette`)

      // Always fetch the full UID set from server — this is the source of truth
      const serverUids   = total > 0 ? await this.client.search({ all: true }, { uid: true }) : []
      const serverUidSet = new Set(serverUids)
      const localUids    = getLocalUids(folder, this.email)
      const localUidSet  = new Set(localUids)

      // 1. Remove messages deleted from server (UID reconciliation)
      const orphans = localUids.filter(uid => !serverUidSet.has(uid))
      if (orphans.length) {
        removeMessages(orphans, folder)
        logDelete(`"${folder}": rimosse ${orphans.length} email eliminate dal server`)
      }

      // 2. Fetch envelopes for messages not yet cached locally
      const newUids  = serverUids.filter(uid => !localUidSet.has(uid))
      // On cold start limit to most recent 200; afterwards fetch all new
      const toFetch  = localUids.length === 0 ? newUids.slice(-200) : newUids
      let   newCount = 0
      let   maxUid   = serverUids.length > 0 ? serverUids[serverUids.length - 1] : 0

      if (toFetch.length) {
        logMail(`"${folder}": scarico ${toFetch.length} email nuove…`)
        for await (const msg of this.client.fetch(toFetch, {
          envelope: true, flags: true, bodyStructure: true, size: true
        }, { uid: true })) {
          this._persistEnvelope(msg, folder)
          newCount++
        }
        logMail(`"${folder}": scaricate ${newCount} email`)
      } else {
        logSync(`"${folder}": nessuna email nuova`)
      }

      // 3. Sync flags for existing messages — catches read/starred changes from other devices
      //    Limit to most recent 200 to stay fast on large folders
      const existingUids  = localUids.filter(uid => serverUidSet.has(uid))
      const flagSyncBatch = existingUids.slice(-200)
      if (flagSyncBatch.length) {
        let flagUpdates = 0
        for await (const msg of this.client.fetch(flagSyncBatch, { flags: true }, { uid: true })) {
          updateMessageFlags(folder, msg.uid, [...(msg.flags || [])])
          flagUpdates++
        }
        logSync(`"${folder}": aggiornati flag su ${flagUpdates} email`)
      }

      if (maxUid > 0) upsertSyncState(this.email, folder, maxUid, total)
      this._lastSyncTime.set(folder, Date.now())
      logSync(`"${folder}": sync completato (nuove: ${newCount}, rimosse: ${orphans.length})`)
      this.emit('sync-complete', { folder, newCount, removedCount: orphans.length })
    } finally {
      lock.release()
    }
  }

  _persistEnvelope(msg, folder) {
    const envelope   = msg.envelope
    const inReplyTo  = envelope.inReplyTo  || null
    const references = envelope.references || null
    const messageId  = envelope.messageId  || null
    const threadId   = computeThreadId(messageId, inReplyTo, references)

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
      snippet:       '',
      has_attachments: this._hasAttachments(msg.bodyStructure),
      size:          msg.size || 0,
      thread_id:     threadId,
      in_reply_to:   inReplyTo,
      message_refs:  references
    })

    this._persistAttachmentMeta(msg, folder, messageId)
  }

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

  async fetchMessages(folder, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize
    const total = getMessageCount(folder)
    const cached = getMessages(folder, pageSize, offset)

    // Sync only when cache is cold AND folder hasn't been synced in the last 30s
    if (cached.length < pageSize && offset === 0) {
      const lastSync = this._lastSyncTime.get(folder) || 0
      if (Date.now() - lastSync > 30000) {
        await this._syncFolder(folder)
      }
    }

    const messages = getMessages(folder, pageSize, offset)
    return {
      messages,
      total: Math.max(total, messages.length),
      page,
      pageSize,
      hasMore: offset + messages.length < total
    }
  }

  async fetchBody(folder, uid) {
    // Return cached body if already fetched
    const cached = getMessageBody(folder, uid)
    if (cached?.body_fetched) {
      return {
        html: cached.body_html || null,
        text: cached.body_text || null,
        attachments: []
      }
    }

    if (!this.client) throw new Error('Not connected')

    const lock = await this.client.getMailboxLock(folder)
    let parsed = null
    try {
      for await (const msg of this.client.fetch(
        { uid },
        { source: true },
        { uid: true }
      )) {
        if (msg.source) {
          // simpleParser handles quoted-printable, base64, charset decoding automatically
          parsed = await simpleParser(msg.source)
        }
      }
    } finally {
      lock.release()
    }

    if (!parsed) return { html: null, text: null, attachments: [] }

    const html    = parsed.html || null
    const text    = parsed.text || null
    const snippet = extractSnippet(text, html)

    saveMessageBody(folder, uid, html, text)
    if (snippet) updateMessageSnippet(folder, uid, snippet)

    const attachments = (parsed.attachments || []).map(a => ({
      filename: a.filename || 'attachment',
      size:     a.size || 0,
      type:     a.contentType || 'application/octet-stream',
      partId:   a.partId || null
    }))

    return { html, text, attachments }
  }

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

  _hasAttachments(structure) {
    if (!structure) return false
    if (structure.disposition === 'attachment') return true
    if (structure.childNodes) {
      return structure.childNodes.some(c => this._hasAttachments(c))
    }
    return false
  }

  // ── Flags ─────────────────────────────────────────────────────────────────

  async setFlag(folder, uid, flag, add) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    try {
      if (add) {
        await this.client.messageFlagsAdd([uid], [flag], { uid: true })
      } else {
        await this.client.messageFlagsRemove([uid], [flag], { uid: true })
      }
      toggleMessageFlag(folder, uid, flag, add)
    } finally {
      lock.release()
    }
  }

  // ── Move / Delete ─────────────────────────────────────────────────────────

  async moveMessage(folder, uid, destination) {
    if (!this.client) throw new Error('Not connected')
    logMove(`Sposto uid=${uid} da "${folder}" → "${destination}"`)
    const lock = await this.client.getMailboxLock(folder)
    try {
      await this.client.messageMove([uid], destination, { uid: true })
      removeMessages([uid], folder)
    } finally {
      lock.release()
    }
  }

  async deleteMessage(folder, uid, permanent = false) {
    if (!this.client) throw new Error('Not connected')

    const folders = getFolders()
    const trashFolder = folders.find(f => f.special_use === '\\Trash')?.path || 'Deleted Messages'

    if (permanent || folder === trashFolder) {
      logDelete(`Elimino definitivamente uid=${uid} da "${folder}"`)
      const lock = await this.client.getMailboxLock(folder)
      try {
        await this.client.messageFlagsAdd([uid], ['\\Deleted'], { uid: true })
        await this.client.messageDelete([uid], { uid: true })
        removeMessages([uid], folder)
      } finally {
        lock.release()
      }
    } else {
      logDelete(`Sposto uid=${uid} nel cestino "${trashFolder}"`)
      await this.moveMessage(folder, uid, trashFolder)
    }
  }

  async markJunk(folder, uid, isJunk) {
    const folders = getFolders()
    if (isJunk) {
      const junkFolder = folders.find(f => f.special_use === '\\Junk')?.path || 'Junk'
      logMove(`Segno come spam uid=${uid} → "${junkFolder}"`)
      await this.moveMessage(folder, uid, junkFolder)
    } else {
      logMove(`Rimuovo spam uid=${uid} → INBOX`)
      await this.moveMessage(folder, uid, 'INBOX')
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(folder, query) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    const results = []
    try {
      // IMAP server-side search
      const uids = await this.client.search({
        or: [
          { subject: query },
          { from: query },
          { body: query }
        ]
      }, { uid: true })

      if (uids?.length) {
        const range = uids.slice(0, 50)
        for await (const msg of this.client.fetch(range, {
          envelope: true,
          flags: true,
          size: true
        }, { uid: true })) {
          const envelope = msg.envelope
          results.push({
            uid: msg.uid,
            folder,
            subject: envelope.subject || '(No subject)',
            from_name: envelope.from?.[0]?.name || '',
            from_email: envelope.from?.[0]?.address || '',
            date: envelope.date ? new Date(envelope.date).getTime() : 0,
            flags: [...(msg.flags || [])],
            snippet: ''
          })
        }
      }
    } finally {
      lock.release()
    }
    return results
  }

  // ── Bulk operations ───────────────────────────────────────────────────────

  async markAllRead(folder) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    try {
      const uids = await this.client.search({ seen: false }, { uid: true })
      if (uids?.length) {
        logMail(`Segno come lette ${uids.length} email in "${folder}"`)
        await this.client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
        for (const uid of uids) toggleMessageFlag(folder, uid, '\\Seen', true)
      } else {
        logMail(`Nessuna email non letta in "${folder}"`)
      }
    } finally {
      lock.release()
    }
  }

  async emptyFolder(folder) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    try {
      const uids = await this.client.search({ all: true }, { uid: true })
      if (uids?.length) {
        logDelete(`Svuoto "${folder}": elimino ${uids.length} email`)
        await this.client.messageFlagsAdd(uids, ['\\Deleted'], { uid: true })
        await this.client.messageDelete(uids, { uid: true })
        removeMessages(uids, folder)
        logDelete(`"${folder}" svuotato`)
      }
    } finally {
      lock.release()
    }
  }

  async bulkSetFlag(folder, uids, flag, add) {
    if (!this.client) throw new Error('Not connected')
    logMail(`Flag "${flag}" ${add ? '+' : '-'} su ${uids.length} email in "${folder}"`)
    const lock = await this.client.getMailboxLock(folder)
    try {
      if (add) {
        await this.client.messageFlagsAdd(uids, [flag], { uid: true })
      } else {
        await this.client.messageFlagsRemove(uids, [flag], { uid: true })
      }
      for (const uid of uids) toggleMessageFlag(folder, uid, flag, add)
    } finally {
      lock.release()
    }
  }

  async bulkDelete(folder, uids) {
    if (!this.client) throw new Error('Not connected')
    const folders = getFolders()
    const trashFolder = folders.find(f => f.special_use === '\\Trash')?.path || 'Deleted Messages'
    logDelete(`Elimino ${uids.length} email da "${folder}"`)
    const lock = await this.client.getMailboxLock(folder)
    try {
      if (folder === trashFolder) {
        await this.client.messageFlagsAdd(uids, ['\\Deleted'], { uid: true })
        await this.client.messageDelete(uids, { uid: true })
      } else {
        await this.client.messageMove(uids, trashFolder, { uid: true })
        logMove(`Spostate ${uids.length} email nel cestino "${trashFolder}"`)
      }
      removeMessages(uids, folder)
    } finally {
      lock.release()
    }
  }

  async bulkMove(folder, uids, destination) {
    if (!this.client) throw new Error('Not connected')
    logMove(`Sposto ${uids.length} email da "${folder}" → "${destination}"`)
    const lock = await this.client.getMailboxLock(folder)
    try {
      await this.client.messageMove(uids, destination, { uid: true })
      removeMessages(uids, folder)
    } finally {
      lock.release()
    }
  }

  // ── Manual sync ───────────────────────────────────────────────────────────

  async syncInbox() {
    await this._syncFolder('INBOX', false)
    await this._syncFolderCounts('INBOX')
  }
}
