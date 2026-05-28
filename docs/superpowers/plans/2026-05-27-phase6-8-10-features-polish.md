# FTS5 Search + Notifications + Settings + UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the FTS5 index (built in Phase 1-2) into an instant local search UI, add proper OS notifications with taskbar badge, complete the Settings panel with signature/density/theme, and apply a systematic UI polish pass (skeletons, empty states, k/j navigation, accessibility labels).

**Architecture:** Search debounces 200ms then hits local FTS5 (fast) before optionally hitting IMAP server-side. Notifications check the `notifyFolders` setting before firing. Taskbar overlay icon updated via `mainWindow.setOverlayIcon()`. Keyboard shortcuts wired with a global `useEffect` in `App.jsx`.

**Tech Stack:** Electron Notification API, `app.setBadgeCount` (macOS overlay) / `mainWindow.setOverlayIcon` (Windows), CSS custom properties for density, React.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/main/index.js` | Modify | Taskbar badge, respect notification settings on new-mail, `window:set-badge` IPC |
| `src/renderer/src/components/Settings.jsx` | Modify | Complete UI: signature editor, density, theme, notification toggles |
| `src/renderer/src/components/MessageList.jsx` | Modify | Search uses FTS5 (already wired via `store:search-local`, just improve debounce/UX) |
| `src/renderer/src/App.jsx` | Modify | Global keyboard shortcuts |
| `src/renderer/src/styles/variables.css` | Modify | Density tokens |
| `src/renderer/src/styles/components.css` | Modify | Loading skeletons, empty state polish |

---

## Task 1: Notifications — taskbar badge + notification settings

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Read notification settings before firing**

In `showNewMailNotification`, add a settings check:

```javascript
function showNewMailNotification(subject, from, folder) {
  try {
    const settings = getSettings()
    if (!settings.notificationsEnabled) return
    const notifyFolders = settings.notifyFolders || ['INBOX']
    if (!notifyFolders.includes(folder)) return
  } catch { /* proceed anyway if settings unavailable */ }

  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'New Mail',
      body: `From: ${from}\n${subject}`,
      icon: join(process.resourcesPath || __dirname, '../../resources/icon.ico'),
      silent: false
    })
    n.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.webContents.send('imap:notification-click', { folder })
    })
    n.show()
  }
}
```

Update all `showNewMailNotification(subject, from)` call sites to pass `folder` as the third argument:

```javascript
// In 'new-mail' event handler:
showNewMailNotification(subject, from, folder)
```

- [ ] **Step 2: Add taskbar overlay badge (Windows)**

Add a helper after `updateTrayMenu`:

```javascript
function updateTaskbarBadge(count) {
  if (!mainWindow) return
  if (count > 0) {
    try {
      // Create a simple red circle overlay icon
      const { nativeImage } = require('electron')
      const size = 16
      const canvas = Buffer.alloc(size * size * 4)
      // Draw a red circle (simple: all pixels red with alpha circle)
      const cx = size / 2, cy = size / 2, r = size / 2 - 1
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          const idx = (y * size + x) * 4
          if (dist <= r) {
            canvas[idx]     = 255  // R
            canvas[idx + 1] = 69   // G
            canvas[idx + 2] = 58   // B
            canvas[idx + 3] = 255  // A
          }
        }
      }
      const overlay = nativeImage.createFromBuffer(canvas, { width: size, height: size })
      mainWindow.setOverlayIcon(overlay, `${count} unread`)
    } catch { /* overlay icon not supported */ }
  } else {
    try { mainWindow.setOverlayIcon(null, '') } catch { /* ignore */ }
  }
}
```

Call `updateTaskbarBadge(unreadCount)` at the end of `updateTrayMenu()` and inside the `unread-count` handler.

- [ ] **Step 3: Add `window:set-badge` IPC for manual badge updates from renderer**

```javascript
ipcMain.handle('window:set-badge', (_e, count) => {
  unreadCount = Math.max(0, count)
  updateTrayMenu()
  updateTaskbarBadge(unreadCount)
})
```

- [ ] **Step 4: Handle notification-click in preload allowed channels**

In `src/preload/index.js`, add `'imap:notification-click'` to the allowed channels array:

```javascript
const allowed = ['imap:new-mail', 'imap:connection-status', 'imap:sync-complete', 'open-compose', 'imap:notification-click']
```

- [ ] **Step 5: Handle notification click in App.jsx**

In `App.jsx`, add in the push event `useEffect`:

```javascript
    const offNotifClick = window.api.on('imap:notification-click', ({ folder }) => {
      dispatch({ type: 'SELECT_FOLDER', payload: folder })
      window.api.window.maximize()  // ensure window is visible
    })
    // cleanup:
    offNotifClick?.()
```

---

## Task 2: FTS5 search UX improvements

**Files:**
- Modify: `src/renderer/src/components/MessageList.jsx`

- [ ] **Step 1: Reduce debounce and show local results immediately**

In `handleSearchInput`, change the structure so local results are shown instantly and IMAP search follows:

```javascript
  function handleSearchInput(e) {
    const q = e.target.value
    setLocalSearch(q)
    clearTimeout(searchDebounce.current)

    if (!q.trim()) {
      dispatch({ type: 'CLEAR_SEARCH' })
      return
    }
    dispatch({ type: 'SET_SEARCH_QUERY', payload: q })

    // Show local FTS5 results immediately (no debounce)
    window.api.store.searchLocal(q).then(lr => {
      if (lr.ok) dispatch({ type: 'SET_SEARCH_RESULTS', payload: lr.results })
    })

    // IMAP server search after 600ms debounce
    searchDebounce.current = setTimeout(async () => {
      const sr = await window.api.imap.search(folder, q)
      if (sr.ok && sr.results?.length) {
        const lr2 = await window.api.store.searchLocal(q)
        const local = lr2.ok ? (lr2.results || []) : []
        const combined = [
          ...local,
          ...sr.results.filter(s => !local.some(l => l.uid === s.uid && l.folder === s.folder))
        ]
        dispatch({ type: 'SET_SEARCH_RESULTS', payload: combined })
      }
    }, 600)
  }
```

---

## Task 3: Settings panel — complete implementation

**Files:**
- Modify (read first): `src/renderer/src/components/Settings.jsx`

- [ ] **Step 1: Read the current Settings.jsx**

Read the file to understand its current structure before modifying.

- [ ] **Step 2: Add tiptap signature editor to Settings**

Import tiptap at the top of Settings.jsx:

```javascript
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
```

In the Settings component, add a signature editor section. Locate or create the signature section and replace any plain textarea with:

```javascript
  const sigEditor = useEditor({
    extensions: [StarterKit, Underline],
    content: localSettings.signature || '',
    onUpdate: ({ editor }) => {
      setLocalSettings(s => ({ ...s, signature: editor.getHTML() }))
    }
  })
```

In the JSX, replace the signature textarea with:

```jsx
            <div className="settings-section">
              <div className="settings-section__label">Email Signature</div>
              <div className="tiptap-editor settings-signature-editor">
                {sigEditor && <EditorContent editor={sigEditor} />}
              </div>
            </div>
```

- [ ] **Step 3: Add display density control**

In the settings state and save function, handle `displayDensity`:

```javascript
  function handleDensityChange(density) {
    setLocalSettings(s => ({ ...s, displayDensity: density }))
    document.documentElement.style.setProperty('--density-scale', {
      compact: '0.85', comfortable: '1', spacious: '1.15'
    }[density] || '1')
  }
```

In the JSX:

```jsx
              <div className="settings-section">
                <div className="settings-section__label">Display Density</div>
                <div className="settings-radio-group">
                  {['compact', 'comfortable', 'spacious'].map(d => (
                    <label key={d} className="settings-radio">
                      <input
                        type="radio"
                        name="density"
                        value={d}
                        checked={(localSettings.displayDensity || 'comfortable') === d}
                        onChange={() => handleDensityChange(d)}
                      />
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
```

- [ ] **Step 4: Add theme toggle**

```jsx
              <div className="settings-section">
                <div className="settings-section__label">Theme</div>
                <div className="settings-radio-group">
                  {['light', 'dark'].map(t => (
                    <label key={t} className="settings-radio">
                      <input
                        type="radio"
                        name="theme"
                        value={t}
                        checked={(localSettings.theme || 'light') === t}
                        onChange={() => {
                          setLocalSettings(s => ({ ...s, theme: t }))
                          dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: t } })
                        }}
                      />
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
```

- [ ] **Step 5: Add notification toggles**

```jsx
              <div className="settings-section">
                <div className="settings-section__label">Notifications</div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={!!localSettings.notificationsEnabled}
                    onChange={e => setLocalSettings(s => ({ ...s, notificationsEnabled: e.target.checked }))}
                  />
                  Enable new mail notifications
                </label>
              </div>
```

- [ ] **Step 6: Add density token to variables.css**

In `src/renderer/src/styles/variables.css`, add to `:root`:

```css
  --density-scale: 1;
```

In `components.css`, apply density to message list items:

```css
.message-item {
  padding: calc(var(--sp-3) * var(--density-scale)) var(--sp-4);
}
```

---

## Task 4: Global keyboard shortcuts

**Files:**
- Modify: `src/renderer/src/App.jsx`

- [ ] **Step 1: Add global keydown handler**

In `App.jsx`, add a `useEffect` for keyboard shortcuts (only active when authenticated and no modal is open):

```javascript
  useEffect(() => {
    if (!state.auth.isAuthenticated) return
    function onKeyDown(e) {
      // Don't fire shortcuts when typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.target.contentEditable === 'true') return

      switch (e.key) {
        case 'c':
          if (!state.compose.isOpen) dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'new' } })
          break
        case 'r':
          if (state.messages.selected && !state.compose.isOpen) {
            dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'reply', message: state.messages.selected } })
          }
          break
        case 'Escape':
          if (state.compose.isOpen) dispatch({ type: 'CLOSE_COMPOSE' })
          if (state.settings.panelOpen) dispatch({ type: 'CLOSE_SETTINGS' })
          break
        case 'Delete':
        case 'Backspace':
          if (state.messages.selected && !state.compose.isOpen) {
            const msg = state.messages.selected
            dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: msg.uid, folder: msg.folder } })
            window.api.imap.deleteMessage(msg.folder, msg.uid, false)
          }
          break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state.auth.isAuthenticated, state.compose.isOpen, state.settings.panelOpen, state.messages.selected, dispatch])
```

---

## Task 5: Loading skeletons

**Files:**
- Modify: `src/renderer/src/styles/components.css`

- [ ] **Step 1: Add skeleton animation and classes**

```css
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 0.8; }
}

.skeleton {
  background: var(--glass-fill);
  border-radius: var(--radius-sm);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
```

- [ ] **Step 2: Replace spinner in MessageList loading state with skeleton rows**

In `MessageList.jsx`, replace the loading state check:

```javascript
// Replace:
state.messages.loading && displayMessages.length === 0 ? (
  <div className="message-list__empty"><div className="spinner" /></div>
)
// With:
state.messages.loading && displayMessages.length === 0 ? (
  <div className="message-list__body" style={{ pointerEvents: 'none' }}>
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="message-item message-item--skeleton">
        <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="skeleton" style={{ width: '60%', height: 12 }} />
          <div className="skeleton" style={{ width: '85%', height: 11 }} />
          <div className="skeleton" style={{ width: '45%', height: 10 }} />
        </div>
      </div>
    ))}
  </div>
)
```

- [ ] **Step 3: Add skeleton message item CSS**

```css
.message-item--skeleton {
  display: flex;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  align-items: flex-start;
  pointer-events: none;
}
```

---

## Task 6: Accessibility labels

**Files:**
- Modify: Various components

- [ ] **Step 1: Add `aria-label` to icon-only buttons**

In `ReadingPane.jsx`, each icon button needs an aria-label:

```jsx
// Replace existing buttons with labeled versions:
<button className="btn btn--ghost" onClick={handleReply} aria-label="Reply">
  <IconReply size={14} /> {t('action.reply')}
</button>
<button className="btn btn--icon" onClick={handleToggleStar} aria-label={isStarred ? 'Unstar' : 'Star'}>
  <IconStar size={16} />
</button>
<button className="btn btn--icon btn--danger" onClick={handleDelete} aria-label="Delete message">
  <IconTrash size={16} />
</button>
```

- [ ] **Step 2: Add `aria-label` to folder items in Sidebar.jsx**

In `FolderItem`, add `aria-label` to the outer div:

```jsx
    aria-label={`${name}${folder.unread_count > 0 ? `, ${folder.unread_count} unread` : ''}`}
```

- [ ] **Step 3: Add `role="list"` and `role="listitem"` to message list**

In `MessageList.jsx`, the `.message-list__body` div:
```jsx
<div className="message-list__body" ref={listRef} onScroll={handleScroll} role="list" aria-label="Messages">
```

Each `MessageItem` outer div:
```jsx
role="listitem"
aria-selected={selected}
aria-label={`${message.from_name || message.from_email}: ${message.subject}`}
```

---

## Task 7: Empty states + error states polish

**Files:**
- Modify: `src/renderer/src/components/ReadingPane.jsx`, `MessageList.jsx`

- [ ] **Step 1: Improve ReadingPane empty state**

Replace the simple empty state with a more polished version:

```jsx
      <div className="reading-pane__empty">
        <div style={{ fontSize: 48, marginBottom: 'var(--sp-3)', opacity: 0.2 }}>✉️</div>
        <span className="reading-pane__empty-text">{t('reading.noMessage')}</span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 200 }}>
          {t('reading.noMessageDesc')}
        </span>
        <button
          className="btn btn--ghost"
          style={{ marginTop: 'var(--sp-4)' }}
          onClick={() => dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'new' } })}
        >
          Compose new message
        </button>
      </div>
```

- [ ] **Step 2: Improve MessageList empty state**

```jsx
      <div className="message-list__empty">
        <div style={{ fontSize: 40, opacity: 0.2 }}>📭</div>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 'var(--weight-medium)' }}>
          {localSearch ? t('messages.noResults') : t('messages.noMessages')}
        </span>
        {localSearch && (
          <button className="btn btn--ghost" onClick={clearSearch} style={{ marginTop: 'var(--sp-2)' }}>
            Clear search
          </button>
        )}
      </div>
```

---

## Checkpoint

After all tasks: output `✅ Phase 6+8+9+10 Features+Polish — FTS5 search instant, taskbar badge, settings complete, skeletons + a11y + keyboard shortcuts`
