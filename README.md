<div align="center">

<img src="resources/icon.png" alt="iCloud Mail" width="96" height="96" />

# Kumo

**A native Windows mail client for iCloud accounts, built with Electron and React.**

[![Platform](https://img.shields.io/badge/platform-Windows-0078d7?logo=windows&logoColor=white)](https://github.com)
[![Electron](https://img.shields.io/badge/Electron-29-47848f?logo=electron&logoColor=white)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://reactjs.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![i18n](https://img.shields.io/badge/languages-8-blueviolet)](#-internationalization)
[![IMAP](https://img.shields.io/badge/protocol-IMAP%20IDLE-orange)](https://datatracker.ietf.org/doc/html/rfc2177)

<br />

> A fast, private, and full-featured desktop mail client for iCloud/IMAP accounts.  
> Real-time push sync, optimistic UI, rich HTML reading pane, and a clean Liquid Glass design.

<br />

<!-- Replace the paths below with actual screenshots once captured -->
![App Screenshot](docs/screenshot-main.png)

</div>

---

## Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Project Structure](#-project-structure)
- [Architecture](#-architecture)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Internationalization](#-internationalization)
- [Settings & Configuration](#-settings--configuration)
- [Data Management](#-data-management)
- [Security & Privacy](#-security--privacy)
- [Building for Production](#-building-for-production)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### Mail
- **IMAP IDLE push sync** — new mail arrives instantly without polling
- **Periodic polling fallback** — configurable interval (1–60 min) when IDLE isn't available
- **Full message list** with pagination and infinite scroll
- **Rich HTML reading pane** — rendered in a sandboxed `<iframe>` for safety
- **Plain-text fallback** when no HTML body is available
- **Attachment list** with filename and size
- **Full-text search** — searches both local cache and the IMAP server simultaneously

### Actions (all optimistic — instant UI, background sync)
- Reply / Reply All / Forward
- Star / Unstar
- Mark as read / unread
- Move to folder
- Mark as junk
- Delete (move to Trash or permanent delete from Trash)
- **Bulk actions** via multi-select: apply any action to dozens of messages at once

### Message List
- **Multi-select** with `Ctrl+Click`, `Ctrl+A` to select all, `Esc` to deselect
- **Filter tabs**: All · Unread · Starred
- **Sort**: Newest · Oldest · Sender · Subject
- Smart date formatting: time for today, day name for this week, date for this year, full date with year for older messages
- Unread count badges per folder
- Avatar with initials and deterministic color per sender

### Folders
- Auto-detection of system folders (Inbox, Sent, Drafts, Trash, Junk, Archive)
- Custom folder support
- **Right-click context menu** per folder: Mark All as Read, Refresh, Empty Trash/Junk
- Folder cache with instant display on launch, refreshed from IMAP in background

### Compose
- Rich text editor powered by [Tiptap](https://tiptap.dev) (bold, italic, underline, lists, links, text align)
- Reply / Reply All / Forward with quoted text
- Optional email signature (configured in Settings)
- SMTP send via nodemailer with iCloud App Password support

### UI & UX
- **Optimistic UI** — every per-message action (star, read, delete, move) is instant with background IMAP sync, exactly like Gmail and Apple Mail
- **Liquid Glass** design language — frosted glass surfaces, backdrop blur, subtle shadows
- **Dark and Light** themes
- **Windows native titlebar** integration with custom drag region
- **Double-click** any message to open it in a standalone viewer window
- Context menus on messages and folders with full action sets
- Loading indicator in sidebar (2 px animated bar + label) for async operations

### Privacy
- **Remote image blocking** — prevents tracking pixels from loading automatically
- Load images on demand with a single click per message
- All data stored locally in SQLite — no cloud middleman

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Shell | [Electron 29](https://electronjs.org) |
| UI Framework | [React 18](https://reactjs.org) + [Vite](https://vitejs.dev) via [electron-vite](https://electron-vite.org) |
| State Management | React `useReducer` + Context (no external lib) |
| IMAP | [imapflow](https://imapflow.com) |
| SMTP | [nodemailer](https://nodemailer.com) |
| Mail Parsing | [mailparser](https://nodemailer.com/extras/mailparser/) |
| Rich Text | [Tiptap](https://tiptap.dev) |
| Local Storage | [sql.js](https://sql.js.org) (SQLite compiled to WASM — no native addons) |
| i18n | Custom hook reading JSON locale files |
| Build / Package | [electron-builder](https://www.electron.build) → NSIS installer |

> **Why sql.js?**  
> `sql.js` is a pure-WASM build of SQLite that requires no native compilation, making it trivially portable across machines and CI environments without `node-gyp`.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- An iCloud account with an [App-Specific Password](https://support.apple.com/en-us/102654) (required by Apple for third-party IMAP/SMTP access)

### Install

```bash
git clone https://github.com/your-username/icloud-mail.git
cd icloud-mail
npm install
```

### Run in Development

```bash
npm run dev
```

Electron and the Vite dev server start together. Hot-reload is active for the renderer process.

### First Launch

1. Enter your iCloud email address (e.g. `you@icloud.com` or `you@me.com`)
2. Enter your **App-Specific Password** (not your Apple ID password — [generate one here](https://appleid.apple.com/account/manage))
3. Click **Connect** — folders load from IMAP and messages appear immediately

---

## 📁 Project Structure

```
icloud-mail/
├── src/
│   ├── main/                   # Electron main process
│   │   ├── index.js            # App bootstrap, IPC handlers, tray, notifications
│   │   ├── auth/               # Credential storage (OS keychain via safeStorage)
│   │   ├── imap/
│   │   │   └── client.js       # ImapClient wrapper (connect, IDLE, fetch, bulk ops)
│   │   ├── smtp/
│   │   │   └── index.js        # nodemailer send helper
│   │   └── store/
│   │       └── db.js           # sql.js SQLite — schema, queries, persistence
│   │
│   ├── preload/
│   │   └── index.js            # contextBridge API surface exposed to renderer
│   │
│   └── renderer/
│       └── src/
│           ├── App.jsx          # Root layout, connection status listener
│           ├── main.jsx         # ReactDOM entry point
│           ├── components/
│           │   ├── Sidebar.jsx         # Folder list, avatar menu, compose button
│           │   ├── MessageList.jsx     # Message list, filter/sort, multi-select
│           │   ├── ReadingPane.jsx     # HTML/text reader, toolbar, attachments
│           │   ├── ComposeWindow.jsx   # Tiptap compose / reply / forward
│           │   ├── ContextMenu.jsx     # Right-click menu (messages)
│           │   ├── Settings.jsx        # Settings panel (offcanvas)
│           │   ├── TitleBar.jsx        # Custom drag region + connection status
│           │   ├── MessageViewerApp.jsx # Standalone viewer window
│           │   └── Icons.jsx           # 25 SVG icon components (Heroicons-style)
│           ├── context/
│           │   └── AppContext.jsx      # Global state (useReducer)
│           ├── i18n/
│           │   └── index.js            # useTranslation() hook
│           ├── locales/                # JSON locale files (en, it, fr, de, es, ru, cn, jp)
│           └── styles/
│               ├── variables.css       # Design tokens (colors, spacing, radius…)
│               ├── global.css          # Reset, app chrome, titlebar
│               └── components.css      # All component styles
│
├── resources/                  # App icons, tray icon
├── scripts/                    # Icon generation helper
├── electron.vite.config.mjs
└── package.json
```

---

## 🏗 Architecture

### IPC Surface (`preload/index.js`)

All communication between renderer and main process goes through `contextBridge`. The exposed `window.api` object is the only bridge:

```
window.api.imap.*      — connect, disconnect, fetchMessages, fetchBody, search,
                          markRead, starMessage, deleteMessage, markJunk, markAllRead,
                          emptyFolder, bulkSetFlag, bulkDelete, bulkMove
window.api.auth.*      — saveCredentials, getCredentials, deleteCredentials
window.api.store.*     — searchLocal, getCachedFolders, clearBodyCache,
                          clearFolderCache, getDbPath, openDbFolder, resetAllData
window.api.settings.*  — get, save
window.api.smtp.*      — send
window.api.window.*    — openMessage, openComposeInMain
window.api.on()        — subscribe to push events (new-mail, connection-status, open-compose)
```

### State Shape (`AppContext`)

```js
{
  auth:       { isAuthenticated, email },
  folders:    { list, selected, loading },
  messages:   { list, selected, total, page, hasMore, loading, searchResults },
  compose:    { isOpen, mode, message },
  settings:   { theme, language, blockRemoteImages, notificationsEnabled,
                syncMode, syncInterval, signature, panelOpen },
  loading:    { active, label },        // sidebar loading bar
  connectionStatus: 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'error'
}
```

### Optimistic UI Pattern

Every per-message action dispatches the state change **before** the IMAP call:

```js
// State updates instantly — user sees the result immediately
dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid, folder, flags: newFlags } })

// IMAP syncs in background — no await, no loading spinner
window.api.imap.bulkSetFlag(folder, uids, '\\Seen', true)
```

This matches the behaviour of Gmail, Apple Mail, and Outlook: the UI is always snappy, the network is invisible to the user.

### SQLite Schema

```sql
CREATE TABLE folders (
  path TEXT UNIQUE, name TEXT, delimiter TEXT,
  special_use TEXT, flags TEXT,
  unread_count INTEGER DEFAULT 0, total_count INTEGER DEFAULT 0
);

CREATE TABLE messages (
  uid INTEGER, folder TEXT, subject TEXT,
  from_name TEXT, from_email TEXT,
  to_addresses TEXT, date INTEGER,
  flags TEXT, snippet TEXT, has_attachments INTEGER,
  body_html TEXT, body_text TEXT, body_fetched INTEGER DEFAULT 0,
  PRIMARY KEY (uid, folder)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Click` | Toggle message in multi-selection |
| `Ctrl + A` | Select all visible messages |
| `Esc` | Clear multi-selection |
| `Enter` | Open focused message |
| `Right-click` (message) | Context menu — reply, star, move, delete… |
| `Right-click` (folder) | Context menu — mark all read, refresh, empty |

---

## 🌍 Internationalization

The app ships with 8 languages, selectable from Settings → Language:

| Code | Language |
|---|---|
| `en` | English |
| `it` | Italiano |
| `fr` | Français |
| `de` | Deutsch |
| `es` | Español |
| `ru` | Русский |
| `cn` | 中文 |
| `jp` | 日本語 |

Adding a new language requires only a new JSON file in `src/renderer/src/locales/` and one import line in `src/renderer/src/i18n/index.js`. Every string in the app is translated — folder names, action labels, loading messages, and settings.

---

## ⚙️ Settings & Configuration

| Setting | Description |
|---|---|
| **Theme** | Dark / Light |
| **Language** | Interface language (8 options) |
| **Block Remote Images** | Prevent tracking pixels and external images from auto-loading |
| **New Mail Notifications** | Windows toast notifications for incoming messages |
| **Sync Mode** | Push (IMAP IDLE) or Interval polling |
| **Check Interval** | 1, 2, 5, 10, 15, 30, or 60 minutes (when using Interval mode) |
| **Signature** | Plain-text signature appended to all outgoing messages |

Settings are persisted to the local SQLite database and applied immediately (theme and language changes take effect without a restart).

---

## 🗄 Data Management

All app data is stored in a single SQLite file located at:

```
%APPDATA%\icloud-mail\db\mail.db
```

From Settings → Data you can:

| Action | Description |
|---|---|
| **Open folder** | Opens the data directory in Windows Explorer |
| **Clear mail cache** | Wipes stored message bodies — re-fetched on next open |
| **Clear folder cache** | Removes the cached folder list — use when you delete folders server-side |
| **Reset all data** | Permanently deletes all messages, folders and settings (requires double confirmation) |

> Credentials (iCloud App Password) are stored separately in the **Windows Credential Manager** via Electron's `safeStorage`, never in the SQLite file.

---

## 🔒 Security & Privacy

- **App-Specific Passwords only** — your Apple ID password is never used or stored
- **Credentials in OS keychain** — Electron `safeStorage` encrypts credentials with DPAPI on Windows
- **No telemetry, no analytics, no cloud sync** — all data stays on your machine
- **Sandboxed HTML renderer** — email bodies are displayed in an `<iframe sandbox="allow-same-origin allow-popups">`, blocking scripts and external navigation
- **Remote image blocking** — enabled by default; images load only on explicit user request
- **Content Security Policy** enforced in both main and renderer windows

---

## 📦 Building for Production

```bash
npm run build
```

Outputs a Windows NSIS installer to `dist/`. The build:

1. Compiles and bundles all source with `electron-vite`
2. Packages with `electron-builder` into an NSIS installer (`iCloud Mail Setup.exe`)
3. Creates a desktop shortcut and Start Menu entry

**Important:** The WASM binary for sql.js (`sql-wasm.wasm`) is copied as an `extraResource` and resolved at runtime. No native compilation is needed.

### Build Requirements

- Windows 10/11 (for NSIS installer generation)
- Node.js ≥ 18
- No additional native build tools required (no `node-gyp`)

---

## 🤝 Contributing

Contributions are welcome. Please:

1. Fork the repo and create a feature branch (`git checkout -b feature/my-feature`)
2. Keep changes focused — one feature or fix per PR
3. Follow the existing code style (no comments unless the *why* is non-obvious, no emojis in code)
4. Test with a real iCloud account before submitting
5. Open a pull request with a clear description of what changed and why

---

## 📝 License

MIT © 2024 — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with [Electron](https://electronjs.org) · [React](https://reactjs.org) · [imapflow](https://imapflow.com) · [Tiptap](https://tiptap.dev) · [sql.js](https://sql.js.org)

</div>
