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
  getMessageBody
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
  }

  // ── Connection ────────────────────────────────────────────────────────────

  async connect() {
    this.emit('connection-status', 'connecting')
    this.client = makeClient(this.email, this.password)

    this.client.on('error', (err) => {
      console.error('IMAP error:', err.message)
      this._scheduleReconnect()
    })

    await this.client.connect()
    this.connected = true
    this.reconnectDelay = 5000
    this.emit('connection-status', 'connected')

    await this._syncFolders()
    await this._syncFolder('INBOX', true)
    await this._startIdle()
  }

  async disconnect() {
    this.connected = false
    clearTimeout(this.reconnectTimer)
    clearInterval(this.syncTimer)

    try { await this.idleClient?.logout() } catch { /* ignore */ }
    try { await this.client?.logout() } catch { /* ignore */ }

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

      const lock = await this.idleClient.getMailboxLock('INBOX')
      try {
        this.idleClient.on('exists', async (data) => {
          const { count, prevCount } = data
          if (count > prevCount) {
            await this._fetchNewMessages('INBOX', prevCount + 1, count)
          }
        })

        this.idleClient.on('flags', async () => {
          await this._syncFolderCounts('INBOX')
        })

        // IDLE loop — imapflow handles the DONE/re-IDLE cycle internally
        // We keep the lock open and await idle; it resolves when a change arrives
        const keepIdling = async () => {
          while (this.connected) {
            try {
              await this.idleClient.idle()
            } catch (err) {
              if (!this.connected) break
              console.error('IDLE error:', err.message)
              await new Promise(r => setTimeout(r, 5000))
            }
          }
        }
        keepIdling().catch(console.error)
      } finally {
        // Lock released when IDLE loop exits
      }
    } catch (err) {
      console.error('Failed to start IDLE:', err.message)
      // Fall back to polling every 2 minutes
      this.syncTimer = setInterval(() => this.syncInbox(), 120000)
    }
  }

  async _fetchNewMessages(folder, seqFrom, seqTo) {
    if (!this.client) return
    const lock = await this.client.getMailboxLock(folder)
    try {
      const range = `${seqFrom}:${seqTo}`
      for await (const msg of this.client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true
      })) {
        const envelope = msg.envelope
        const parsed = {
          uid: msg.uid,
          folder,
          message_id: envelope.messageId || '',
          subject: envelope.subject || '(No subject)',
          from_name: envelope.from?.[0]?.name || envelope.from?.[0]?.address || '',
          from_email: envelope.from?.[0]?.address || '',
          to_addresses: parseAddressList(envelope.to),
          cc_addresses: parseAddressList(envelope.cc),
          date: envelope.date ? new Date(envelope.date).getTime() : Date.now(),
          flags: [...(msg.flags || [])],
          snippet: '',
          has_attachments: this._hasAttachments(msg.bodyStructure),
          size: msg.size || 0
        }
        upsertMessage(parsed)

        if (!msg.flags?.has('\\Seen')) {
          this.emit('new-mail', {
            subject: parsed.subject,
            from: parsed.from_name || parsed.from_email,
            folder,
            uid: parsed.uid
          })
        }
      }
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

  async _syncFolder(folder, background = false) {
    if (!this.client) return
    const lock = await this.client.getMailboxLock(folder)
    try {
      const status = await this.client.status(folder, { messages: true, unseen: true })
      const total = status.messages || 0
      const unseen = status.unseen || 0
      updateFolderCounts(folder, unseen, total)

      if (total === 0) return

      // Fetch latest 200 message envelopes for initial cache
      const from = Math.max(1, total - 199)
      const range = `${from}:*`
      for await (const msg of this.client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true
      })) {
        const envelope = msg.envelope
        upsertMessage({
          uid: msg.uid,
          folder,
          message_id: envelope.messageId || '',
          subject: envelope.subject || '(No subject)',
          from_name: envelope.from?.[0]?.name || envelope.from?.[0]?.address || '',
          from_email: envelope.from?.[0]?.address || '',
          to_addresses: parseAddressList(envelope.to),
          cc_addresses: parseAddressList(envelope.cc),
          date: envelope.date ? new Date(envelope.date).getTime() : Date.now(),
          flags: [...(msg.flags || [])],
          snippet: '',
          has_attachments: this._hasAttachments(msg.bodyStructure),
          size: msg.size || 0
        })
      }
    } finally {
      lock.release()
    }
  }

  async fetchMessages(folder, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize
    const total = getMessageCount(folder)
    const cached = getMessages(folder, pageSize, offset)

    // If cache is cold or we want fresh data, sync from server
    if (cached.length < pageSize && offset === 0) {
      await this._syncFolder(folder)
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

    const html = parsed.html || null
    const text = parsed.text || null
    const attachments = (parsed.attachments || []).map(a => ({
      filename: a.filename || 'attachment',
      size: a.size || 0,
      type: a.contentType || 'application/octet-stream'
    }))

    saveMessageBody(folder, uid, html, text)
    return { html, text, attachments }
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
        await this.client.messageFlagsAdd({ uid }, [flag], { uid: true })
      } else {
        await this.client.messageFlagsRemove({ uid }, [flag], { uid: true })
      }
    } finally {
      lock.release()
    }
  }

  // ── Move / Delete ─────────────────────────────────────────────────────────

  async moveMessage(folder, uid, destination) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    try {
      await this.client.messageMove([uid], destination, { uid: true })
    } finally {
      lock.release()
    }
  }

  async deleteMessage(folder, uid, permanent = false) {
    if (!this.client) throw new Error('Not connected')

    const folders = getFolders()
    const trashFolder = folders.find(f => f.special_use === '\\Trash')?.path || 'Deleted Messages'

    if (permanent || folder === trashFolder) {
      const lock = await this.client.getMailboxLock(folder)
      try {
        await this.client.messageFlagsAdd([uid], ['\\Deleted'], { uid: true })
        await this.client.messageDelete([uid], { uid: true })
      } finally {
        lock.release()
      }
    } else {
      await this.moveMessage(folder, uid, trashFolder)
    }
  }

  async markJunk(folder, uid, isJunk) {
    const folders = getFolders()
    if (isJunk) {
      const junkFolder = folders.find(f => f.special_use === '\\Junk')?.path || 'Junk'
      await this.moveMessage(folder, uid, junkFolder)
    } else {
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
        await this.client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
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
        await this.client.messageFlagsAdd(uids, ['\\Deleted'], { uid: true })
        await this.client.messageDelete(uids, { uid: true })
      }
    } finally {
      lock.release()
    }
  }

  async bulkSetFlag(folder, uids, flag, add) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    try {
      if (add) {
        await this.client.messageFlagsAdd(uids, [flag], { uid: true })
      } else {
        await this.client.messageFlagsRemove(uids, [flag], { uid: true })
      }
    } finally {
      lock.release()
    }
  }

  async bulkDelete(folder, uids) {
    if (!this.client) throw new Error('Not connected')
    const folders = getFolders()
    const trashFolder = folders.find(f => f.special_use === '\\Trash')?.path || 'Deleted Messages'
    const lock = await this.client.getMailboxLock(folder)
    try {
      if (folder === trashFolder) {
        await this.client.messageFlagsAdd(uids, ['\\Deleted'], { uid: true })
        await this.client.messageDelete(uids, { uid: true })
      } else {
        await this.client.messageMove(uids, trashFolder, { uid: true })
      }
    } finally {
      lock.release()
    }
  }

  async bulkMove(folder, uids, destination) {
    if (!this.client) throw new Error('Not connected')
    const lock = await this.client.getMailboxLock(folder)
    try {
      await this.client.messageMove(uids, destination, { uid: true })
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
