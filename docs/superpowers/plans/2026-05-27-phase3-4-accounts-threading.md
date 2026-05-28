# Multi-Account + Conversation Threading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiple iCloud accounts (each with its own IMAP connection) and group messages in the list view by conversation thread using the thread_id already computed in Phase 1-2.

**Architecture:** `imapClient` in `main/index.js` becomes a `Map<email, ImapClient>`. The IPC channel `imap:connect` is extended with an `accountId` (email) parameter — existing callers that omit it fall back to the single stored credential. Thread grouping is entirely in the renderer: `AppContext` builds a `threads` map from the flat `messages.list`, and `MessageList` renders thread headers with collapse/expand.

**Tech Stack:** Electron safeStorage (per-account credential files), imapflow, React useReducer.

**⚠️ IPC contract change — human sign-off required before starting Task 2.**

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/main/auth/index.js` | Modify | Per-account credential files |
| `src/main/index.js` | Modify | `imapClient` Map, multi-account IPC, unified unread count |
| `src/preload/index.js` | Modify | New params on `api.imap.connect`, `api.imap.disconnect` |
| `src/renderer/src/context/AppContext.jsx` | Modify | `accounts` slice, thread grouping selector |
| `src/renderer/src/components/Sidebar.jsx` | Modify | Account switcher + per-account folder trees |
| `src/renderer/src/components/MessageList.jsx` | Modify | Thread grouping, expand/collapse |
| `src/renderer/src/components/Settings.jsx` | Modify | Account add/edit/delete UI |

---

## Task 1: Per-account credential storage

**Files:**
- Modify: `src/main/auth/index.js`

- [ ] **Step 1: Replace single-account credential functions with multi-account versions**

```javascript
import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function credsDir() {
  const dir = join(app.getPath('userData'), 'auth')
  mkdirSync(dir, { recursive: true })
  return dir
}

function credsFile(email) {
  // Sanitize email to safe filename
  return join(credsDir(), `${email.replace(/[^a-z0-9@._-]/gi, '_')}.bin`)
}

export async function saveCredentials(email, password) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available')
  const encrypted = safeStorage.encryptString(JSON.stringify({ email, password }))
  writeFileSync(credsFile(email), encrypted)
}

export async function getCredentials(email) {
  if (email) {
    const path = credsFile(email)
    if (!existsSync(path)) return null
    try {
      const buf = readFileSync(path)
      return JSON.parse(safeStorage.decryptString(buf))
    } catch { return null }
  }
  // No email: return the first stored credential (backward compat)
  const dir = credsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.bin'))
  if (!files.length) return null
  try {
    const buf = readFileSync(join(dir, files[0]))
    return JSON.parse(safeStorage.decryptString(buf))
  } catch { return null }
}

export async function deleteCredentials(email) {
  if (email) {
    const path = credsFile(email)
    if (existsSync(path)) unlinkSync(path)
    return
  }
  // Delete all
  const dir = credsDir()
  readdirSync(dir).filter(f => f.endsWith('.bin')).forEach(f => unlinkSync(join(dir, f)))
}

export async function listStoredEmails() {
  const dir = credsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.bin'))
  const emails = []
  for (const file of files) {
    try {
      const buf = readFileSync(join(dir, file))
      const { email } = JSON.parse(safeStorage.decryptString(buf))
      emails.push(email)
    } catch { /* skip corrupt file */ }
  }
  return emails
}
```

---

## Task 2: Multi-account IMAP manager in main/index.js

**⚠️ This task changes the `imap:connect` and `imap:disconnect` IPC signatures. Confirm with human before applying.**

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Replace single `imapClient` with a Map**

Replace the top-level declaration (line 8):
```javascript
let imapClient = null
```
with:
```javascript
const imapClients = new Map()   // email → ImapClient
const unreadCounts = new Map()  // email → number
```

- [ ] **Step 2: Add `_createImapClient` factory**

Add this function before `createWindow()`:

```javascript
function _attachClientEvents(email, client) {
  client.on('new-mail', ({ subject, from, folder, uid }) => {
    const cur = unreadCounts.get(email) || 0
    unreadCounts.set(email, cur + 1)
    updateTrayMenu()
    showNewMailNotification(subject, from)
    mainWindow?.webContents.send('imap:new-mail', { subject, from, folder, uid, account: email })
  })
  client.on('connection-status', (status) => {
    mainWindow?.webContents.send('imap:connection-status', { status, account: email })
  })
  client.on('unread-count', (count) => {
    unreadCounts.set(email, count)
    updateTrayMenu()
  })
  client.on('sync-complete', ({ folder, newCount }) => {
    mainWindow?.webContents.send('imap:sync-complete', { folder, newCount, account: email })
  })
}
```

- [ ] **Step 3: Update `imap:connect` handler to support multi-account**

Replace the entire `ipcMain.handle('imap:connect', ...)` block:

```javascript
ipcMain.handle('imap:connect', async (_e, email, password) => {
  try {
    if (!email || !password) return { ok: false, error: 'email and password required' }
    // Disconnect existing client for this account if any
    const existing = imapClients.get(email)
    if (existing) await existing.disconnect().catch(() => {})

    const client = new ImapClient(email, password)
    _attachClientEvents(email, client)
    imapClients.set(email, client)
    await client.connect()
    return { ok: true }
  } catch (err) {
    imapClients.delete(email)
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 4: Update `imap:disconnect` handler**

```javascript
ipcMain.handle('imap:disconnect', async (_e, email) => {
  try {
    if (email) {
      const client = imapClients.get(email)
      if (client) { await client.disconnect(); imapClients.delete(email) }
    } else {
      for (const [e, c] of imapClients) {
        await c.disconnect().catch(() => {})
        imapClients.delete(e)
      }
    }
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})
```

- [ ] **Step 5: Update all other `imap:*` handlers to route by account**

Each `imap:*` handler that currently does `if (!imapClient)` needs updating. Pattern:

```javascript
// Helper used by every handler that needs a client
function getClient(email) {
  if (email) return imapClients.get(email) || null
  // Fall back to first available client for backward compat
  return imapClients.values().next().value || null
}
```

Add this helper at the top of the IPC section. Then for each handler, replace:
```javascript
if (!imapClient) return { ok: false, error: 'Not connected' }
```
with:
```javascript
const imapClient = getClient(email)  // email is a new optional param
if (!imapClient) return { ok: false, error: 'Not connected' }
```

Each `ipcMain.handle` signature gets an optional `email` parameter added where needed (e.g., `async (_e, folder, page, pageSize, email)`).

- [ ] **Step 6: Update `app.whenReady` auto-connect to connect all stored accounts**

Replace the single-account auto-connect block with:

```javascript
  const storedEmails = await listStoredEmails()
  for (const email of storedEmails) {
    const creds = await getCredentials(email)
    if (!creds) continue
    const client = new ImapClient(creds.email, creds.password)
    _attachClientEvents(creds.email, client)
    imapClients.set(creds.email, client)
    client.connect().catch(err => console.error(`Auto-connect failed for ${creds.email}:`, err.message))
  }
```

- [ ] **Step 7: Update `before-quit` to disconnect all clients**

```javascript
app.on('before-quit', async () => {
  for (const client of imapClients.values()) {
    await client.disconnect().catch(() => {})
  }
  closeDB()
})
```

- [ ] **Step 8: Update `updateTrayMenu` to sum all unread counts**

```javascript
function updateTrayMenu() {
  if (!tray) return
  unreadCount = [...unreadCounts.values()].reduce((a, b) => a + b, 0)
  // rest of existing function unchanged
```

---

## Task 3: AppContext accounts slice

**Files:**
- Modify: `src/renderer/src/context/AppContext.jsx`

- [ ] **Step 1: Add `accounts` to initial state**

```javascript
const initialState = {
  // ... existing fields
  accounts: {
    list: [],          // [{ email, display_name, is_default, ... }]
    activeEmail: null  // which account's folder tree is shown in sidebar
  },
  // ...
}
```

- [ ] **Step 2: Add account reducer cases**

```javascript
    case 'SET_ACCOUNTS':
      return {
        ...state,
        accounts: {
          ...state.accounts,
          list: action.payload,
          activeEmail: state.accounts.activeEmail || action.payload[0]?.email || null
        }
      }
    case 'SWITCH_ACCOUNT':
      return {
        ...state,
        accounts: { ...state.accounts, activeEmail: action.payload },
        folders: { ...state.folders, selected: 'INBOX', list: [] },
        messages: { ...state.messages, list: [], selected: null, page: 1 }
      }
    case 'ADD_ACCOUNT':
      return {
        ...state,
        accounts: {
          ...state.accounts,
          list: [...state.accounts.list.filter(a => a.email !== action.payload.email), action.payload]
        }
      }
    case 'REMOVE_ACCOUNT': {
      const list = state.accounts.list.filter(a => a.email !== action.payload)
      return {
        ...state,
        accounts: {
          list,
          activeEmail: state.accounts.activeEmail === action.payload
            ? (list[0]?.email || null)
            : state.accounts.activeEmail
        }
      }
    }
```

- [ ] **Step 3: Update `checkAuth` in AppProvider to load all accounts**

```javascript
  useEffect(() => {
    async function checkAuth() {
      const accRes = await window.api.accounts.list()
      if (accRes.ok && accRes.accounts?.length) {
        dispatch({ type: 'SET_ACCOUNTS', payload: accRes.accounts })
        dispatch({ type: 'SET_AUTHENTICATED', payload: accRes.accounts[0].email })
      } else {
        // Fall back to single-account credential check
        const result = await window.api.auth.getCredentials()
        if (result.ok && result.creds) {
          dispatch({ type: 'SET_AUTHENTICATED', payload: result.creds.email })
          // Register this as the first account
          await window.api.accounts.save({
            email: result.creds.email,
            display_name: result.creds.email,
            is_default: 1
          })
        }
      }
      const settingsRes = await window.api.settings.get()
      if (settingsRes.ok) dispatch({ type: 'UPDATE_SETTINGS', payload: settingsRes.settings })
    }
    checkAuth()
  }, [])
```

---

## Task 4: Sidebar account switcher

**Files:**
- Modify: `src/renderer/src/components/Sidebar.jsx`

- [ ] **Step 1: Add account switcher row above folder list**

Inside the `Sidebar` return, before `<div className="sidebar__folders">`, add:

```jsx
      {state.accounts.list.length > 1 && (
        <div className="sidebar__accounts">
          {state.accounts.list.map(acc => (
            <button
              key={acc.email}
              className={`sidebar__account-btn${state.accounts.activeEmail === acc.email ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SWITCH_ACCOUNT', payload: acc.email })}
              title={acc.email}
            >
              {(acc.display_name || acc.email).slice(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 2: Add CSS for account switcher in components.css**

```css
.sidebar__accounts {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--glass-border);
}

.sidebar__account-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: var(--glass-fill);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default);
}

.sidebar__account-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
}
```

---

## Task 5: Conversation threading in MessageList

**Files:**
- Modify: `src/renderer/src/components/MessageList.jsx`

- [ ] **Step 1: Add thread grouping logic**

Add this helper near the top of the `MessageList` component (before the return):

```javascript
  function groupByThread(messages) {
    const threadMap = new Map()
    for (const msg of messages) {
      const tid = msg.thread_id || `single-${msg.uid}-${msg.folder}`
      if (!threadMap.has(tid)) threadMap.set(tid, [])
      threadMap.get(tid).push(msg)
    }
    // Sort each thread by date asc (oldest first within thread)
    for (const msgs of threadMap.values()) {
      msgs.sort((a, b) => (a.date || 0) - (b.date || 0))
    }
    // Return array of { threadId, messages, latest } sorted by latest message date desc
    return [...threadMap.entries()]
      .map(([threadId, msgs]) => ({
        threadId,
        messages: msgs,
        latest: msgs.reduce((a, b) => (b.date || 0) > (a.date || 0) ? b : a)
      }))
      .sort((a, b) => (b.latest.date || 0) - (a.latest.date || 0))
  }
```

- [ ] **Step 2: Add `expandedThreads` state**

```javascript
  const [expandedThreads, setExpandedThreads] = useState(new Set())
```

- [ ] **Step 3: Use thread groups in render**

Replace the `displayMessages.map(msg => ...)` section with thread-aware rendering:

```jsx
          {groupByThread(displayMessages).map(({ threadId, messages: threadMsgs, latest }) => {
            const isExpanded = expandedThreads.has(threadId)
            const isMulti    = threadMsgs.length > 1
            const msgsToShow = isExpanded ? threadMsgs : [latest]

            return (
              <React.Fragment key={threadId}>
                {msgsToShow.map((msg, idx) => (
                  <MessageItem
                    key={`${msg.folder}-${msg.uid}`}
                    message={msg}
                    selected={primaryUid === msg.uid && selectedKeys.size === 0}
                    multiSelected={selectedKeys.has(msgKey(msg))}
                    threadCount={idx === 0 && isMulti ? threadMsgs.length : null}
                    isThreadChild={idx > 0}
                    onThreadExpand={isMulti && idx === 0 ? () => setExpandedThreads(prev => {
                      const next = new Set(prev)
                      next.has(threadId) ? next.delete(threadId) : next.add(threadId)
                      return next
                    }) : null}
                    onClick={e => handleItemClick(e, msg)}
                    onDoubleClick={() => window.api.window.openMessage(msg)}
                    onContextMenu={e => handleItemContextMenu(e, msg)}
                    onDragStart={e => {
                      const isInSelection = selectedKeys.has(msgKey(msg)) && selectedKeys.size > 1
                      const toMove = isInSelection
                        ? displayMessages.filter(m => selectedKeys.has(msgKey(m)))
                        : [msg]
                      e.dataTransfer.setData('x-mail-messages', JSON.stringify(
                        toMove.map(m => ({ uid: m.uid, folder: m.folder }))
                      ))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  />
                ))}
              </React.Fragment>
            )
          })}
```

- [ ] **Step 4: Update `MessageItem` to accept thread props**

Add to `MessageItem` function signature:

```javascript
function MessageItem({ message, selected, multiSelected, threadCount, isThreadChild, onThreadExpand, onClick, onDoubleClick, onContextMenu, onDragStart }) {
```

Add thread count badge in the row1 div, after the sender span:

```jsx
          {threadCount && (
            <span
              className="message-item__thread-count"
              onClick={e => { e.stopPropagation(); onThreadExpand?.() }}
              title={`${threadCount} messages in thread`}
            >{threadCount}</span>
          )}
```

Add indentation for thread children:

```jsx
      className={`message-item${selected ? ' selected' : ''}${isUnread ? ' unread' : ''}${multiSelected ? ' multi-selected' : ''}${isThreadChild ? ' thread-child' : ''}`}
```

- [ ] **Step 5: Add thread CSS in components.css**

```css
.message-item__thread-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--sp-1);
  background: var(--accent-subtle);
  color: var(--accent);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  flex-shrink: 0;
}

.message-item.thread-child {
  padding-left: calc(var(--sp-4) + 24px);
  border-left: 2px solid var(--glass-border);
  margin-left: var(--sp-4);
}
```

---

## Checkpoint

After all tasks: output `✅ Phase 3-4 Multi-account + Threading — multiple accounts connected, conversation threads grouped in list`
