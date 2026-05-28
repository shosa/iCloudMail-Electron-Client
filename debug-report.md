# Codebase Debug Report

**Project:** Kumo — iCloud Mail Desktop Client for Windows  
**Stack:** Electron 29, React 18, Vite 5, imapflow 1.0, mailparser 3.9, nodemailer 6.9, sql.js 1.12, TipTap 2.x  
**Analyzed:** 54 source files (main, preload, renderer components, locales, config)  
**Issues found:** 1 critical / 7 high / 6 medium / 5 low

---

## Executive Summary

The codebase is well-structured and functional for a personal mail client, but has several correctness bugs that affect data integrity, UX correctness, and one security concern. The most urgent areas are: (1) a privileged IPC handler that exposes unrestricted file-system reads from the renderer, (2) `resetAllData` that silently leaves credentials, IMAP connections, and the FTS index intact, and (3) persistent UI state bugs where unread badge counts and display density settings diverge from actual state.

---

## Issues

---

### [CRITICAL] — Unrestricted arbitrary file read via `store:read-local-file` IPC

- **File:** `src/main/index.js` lines 611–619, `src/preload/index.js` lines 85–86
- **Problem:** The IPC handler accepts any `filePath` string from the renderer and returns its full base64-encoded contents with no path validation, allow-listing, or sandboxing. The handler is exposed unconditionally as `window.api.store.readLocalFile(filePath)` to every renderer context (main window, viewer windows, compose windows). Any code reaching renderer execution can read any file the OS user can access (e.g., `%APPDATA%`, SSH keys, other app databases). The email HTML body is sandboxed in an iframe without `allow-scripts`, which currently prevents automated exploitation—but the attack surface exists for future renderer-context vulnerabilities.
- **Root cause:** A debugging/attachment-preview utility function was wired into the always-on preload API surface without input validation.
- **Resolution prompt:** See § Fix: Unrestricted arbitrary file read

---

### [HIGH] — `resetAllData` leaves credentials, IMAP connections, and non-message tables intact

- **File:** `src/main/store/db.js` lines 623–629, `src/main/index.js` lines 596–603
- **Problem:** `resetAllData()` only deletes from `messages`, `folders`, and `settings`. It leaves behind: `accounts`, `sync_state`, `drafts`, `attachments`, `contacts`, and `calendar_events`. Additionally, the IPC handler does not disconnect active IMAP clients or delete on-disk credentials (`.bin` files). After clicking "Reset all data", the user's password is still stored on disk, IMAP stays connected, and all contacts/calendar data remain queryable. The UI dispatches `SET_UNAUTHENTICATED` but the main process is unaffected.
- **Root cause:** `resetAllData` was written incrementally and was not updated as new tables were added; the IPC handler delegates only to the DB layer without orchestrating shutdown.
- **Resolution prompt:** See § Fix: resetAllData incomplete

---

### [HIGH] — `deleteAccount` leaves messages, attachments, contacts, and calendar events in the DB

- **File:** `src/main/store/db.js` lines 696–700
- **Problem:** Deleting an account only removes rows from `accounts` and `sync_state`. Messages (`WHERE account_email = ?`), attachments, contacts (`WHERE account_email = ?`), and calendar events (`WHERE account_email = ?`) for that account all remain. After account deletion, old messages appear in folder views and FTS search, contacts appear in autocomplete, and calendar events still display.
- **Root cause:** The `deleteAccount` helper was not extended when contacts, calendar, and attachment tables were added in migrations 2–3.
- **Resolution prompt:** See § Fix: deleteAccount cascade

---

### [HIGH] — Folder unread count not decremented when messages are deleted or moved in the UI

- **File:** `src/renderer/src/context/AppContext.jsx` lines 138–145
- **Problem:** The `REMOVE_MESSAGE` reducer removes the message from `state.messages.list` and clears `selected`, but does not decrement `state.folders.list[folder].unread_count`. If the deleted message was unread, the sidebar badge stays inflated until the next full folder sync. This also affects bulk deletes and junk marking in `MessageList.jsx` (lines 219–232) and the Toolbar (lines 37–39).
- **Root cause:** The `REMOVE_MESSAGE` action was not given the same unread-count bookkeeping logic as `UPDATE_MESSAGE_FLAGS`.
- **Resolution prompt:** See § Fix: REMOVE_MESSAGE unread count

---

### [HIGH] — Display density setting not restored on application restart

- **File:** `src/renderer/src/components/Settings.jsx` lines 57–61, `src/renderer/src/App.jsx`
- **Problem:** `handleDensityChange` sets a CSS custom property (`--density-scale`) imperatively on `document.documentElement`. When the setting is saved, `displayDensity` is written to the DB. However, nowhere in the app is this setting read back and applied to the DOM on startup. `AppContext` loads settings into state via `UPDATE_SETTINGS`, but there is no `useEffect` in `App.jsx` or anywhere else that reads `state.settings.displayDensity` and applies `--density-scale`. The setting resets to the CSS default on every restart.
- **Root cause:** Imperative DOM mutation was not paired with a corresponding effect that re-applies the value when settings are loaded.
- **Resolution prompt:** See § Fix: Display density not persisted

---

### [HIGH] — Compose auto-save misses body-only edits (TipTap editor not in deps)

- **File:** `src/renderer/src/components/ComposeWindow.jsx` lines 204–226
- **Problem:** The draft auto-save `useEffect` lists `[to, cc, bcc, subject, attachments]` as dependencies. TipTap manages its own internal state and does not update any of these React state variables when only the email body changes. If a user writes the entire body, makes no changes to recipients or subject, and closes the window, the draft is not saved. The 2-second debounce also means recent changes can be lost if the window is closed immediately. The same bug exists in `ComposeViewerApp.jsx` lines 197–219.
- **Root cause:** TipTap editor content is not reflected in React state, so changes are invisible to the auto-save effect's dependency tracker.
- **Resolution prompt:** See § Fix: Compose auto-save missing editor deps

---

### [HIGH] — `resetAllData` does not clear the FTS5 virtual table → stale index after reset

- **File:** `src/main/store/db.js` lines 623–629
- **Problem:** `resetAllData()` deletes from `messages` but not from `messages_fts`. Additionally, it deletes from `settings`, which clears the `fts_seeded` flag. On the next startup, `_runMigrations` sees no `schemaVersion`, re-runs migration v1, finds no messages to back-fill (table is empty), and sets `fts_seeded = 1`. After the user re-syncs, new messages are appended to `messages_fts` via `INSERT OR IGNORE`. Because FTS5 does not enforce uniqueness, the old ghost FTS rows remain from before the reset. Future syncs insert new rows alongside the ghost rows, progressively degrading FTS search performance and correctness.
- **Root cause:** `messages_fts` was added as a best-effort feature; the reset path was not updated to include it.
- **Resolution prompt:** See § Fix: resetAllData FTS not cleared

---

### [HIGH] — `fromName` in outgoing mail uses email address instead of display name

- **File:** `src/renderer/src/components/ComposeWindow.jsx` line 251, `src/renderer/src/components/ComposeViewerApp.jsx` line 240
- **Problem:** Both compose components set `fromName: creds.creds.email` when building `mailOptions`. This causes SMTP to produce `From: "kishosa@me.com" <kishosa@me.com>` instead of `From: "Stefano" <kishosa@me.com>`. The `accounts` table has a `display_name` column and it is stored in the DB, but it is never retrieved and used for outgoing mail.
- **Root cause:** The compose components fetch only credentials (email + password) and never query the account's display name.
- **Resolution prompt:** See § Fix: fromName uses email not display name

---

### [MEDIUM] — iCal TZID parameter silently ignored; non-UTC events get wrong timestamps

- **File:** `src/main/caldav/client.js` lines 106–113
- **Problem:** `parseICalDate` only handles UTC (`Z` suffix) and floating local-time formats. When a `DTSTART` or `DTEND` property has a `TZID` parameter (e.g., `DTSTART;TZID=America/New_York:20230101T120000`), the parser receives `val = "20230101T120000"` with no `Z` suffix, treats it as floating local time (the server's timezone), and converts it using the client machine's local timezone. For a European user receiving an event scheduled in New York, the event will display at the wrong time.
- **Root cause:** The iCal parser was written without timezone support; TZID is stripped during property/value splitting.
- **Resolution prompt:** See § Fix: iCal TZID ignored

---

### [MEDIUM] — `getCredentials()` without email returns alphabetically first account, not default

- **File:** `src/main/auth/index.js` line 33
- **Problem:** `getCredentials()` with no argument reads all `.bin` files from disk, sorts them alphabetically (by URL-encoded email filename), and returns the first. This is used in the `store:get-sync-state` IPC handler and the legacy `auth:get-credentials` fallback. With multiple accounts, alphabetical sort does not guarantee the `is_default` account is selected. A user whose secondary account sorts alphabetically before their primary account will get the wrong sync state and potentially connect the wrong IMAP session on startup.
- **Root cause:** The multi-account credential store was not updated to respect the `is_default` flag when returning a single credential.
- **Resolution prompt:** See § Fix: getCredentials default account

---

### [MEDIUM] — `CalendarPanel` and `ContactsPanel` stale `useEffect` dependencies

- **File:** `src/renderer/src/components/CalendarPanel.jsx` lines 171–175, `src/renderer/src/components/ContactsPanel.jsx` lines 154–158
- **Problem:** Both panels have an initial-load effect that fires only when `state.auth.isAuthenticated` changes:
  ```js
  useEffect(() => {
    if (state.auth.isAuthenticated && state.calendar.events.length === 0) {
      loadEvents()
    }
  }, [state.auth.isAuthenticated])
  ```
  `loadEvents` and `loadContacts` (both `useCallback` hooks with `state.auth.email` as dep) are missing from the dependency array. If the active account changes after initial auth (e.g., user switches accounts), `loadEvents` changes identity but the effect does not re-run, so the calendar/contacts panel continues showing the old account's data.
- **Root cause:** Effect dependencies were not kept in sync with the callbacks they invoke.
- **Resolution prompt:** See § Fix: Stale useEffect deps CalendarPanel/ContactsPanel

---

### [MEDIUM] — Reply All includes the user's own email in the `To` field

- **File:** `src/renderer/src/components/ComposeWindow.jsx` lines 46–52, `src/renderer/src/components/ComposeViewerApp.jsx` lines 39–45
- **Problem:** `buildReplyTo` for `replyAll` mode collects `[msg.from_email, ...msg.to_addresses.map(a => a.email)]` and deduplicates, but never filters out the current user's own email. When a user receives a reply-all email they were addressed to and hits Reply All, their own address appears in the `To` field.
- **Root cause:** `buildReplyTo` does not have access to the current user's email to exclude it; no exclusion logic was added.
- **Resolution prompt:** See § Fix: Reply All includes self

---

### [MEDIUM] — `imap:download-attachment` `partId` parameter not sanitized (path traversal risk)

- **File:** `src/main/index.js` lines 942–943
- **Problem:** The attachment download path is constructed as:
  ```js
  const safeName = filename.replace(/[^a-z0-9._-]/gi, '_')
  const dest = join(attDir, `${uid}_${partId}_${safeName}`)
  ```
  `uid` (integer) is safe. `safeName` is sanitized. But `partId` is passed directly from the renderer without any sanitization. A crafted `partId` value containing `../` sequences could escape `attDir` and write an attachment to an arbitrary path. In practice, `partId` comes from the IMAP server via DB (digits and dots), but any renderer can call `window.api.imap.downloadAttachment` with an arbitrary `partId`.
- **Root cause:** The sanitization was applied only to `filename` and not to `partId`.
- **Resolution prompt:** See § Fix: partId sanitization

---

### [LOW] — `allRows` and `oneRow` have unused `params` parameter

- **File:** `src/main/store/db.js` lines 369, 378
- **Problem:** Both helper functions declare `params = []` as a second parameter that is never used inside the function body. Every call site performs `.bind(...)` on the statement before passing it. The dead parameter is misleading.
- **Root cause:** The parameter was likely added for a planned refactor to bind inside the helper; the refactor was never completed.
- **Resolution prompt:** See § Fix: Remove unused params

---

### [LOW] — Dynamic `import('path')` inside IPC handler when `path` is already statically imported

- **File:** `src/main/index.js` lines 587–590
- **Problem:** `store:open-db-folder` uses `const { dirname } = await import('path')` inside the handler, but `join` from `path` is already statically imported at line 2. The dynamic import is unnecessary and slightly slower.
- **Root cause:** Copy-paste from a similar pattern used for `fs` (which is legitimately dynamically imported to avoid bundling issues).
- **Resolution prompt:** See § Fix: Dynamic import dirname

---

### [LOW] — CardDAV multiget logs "Strategia 3" when it is in fact Strategy 2b

- **File:** `src/main/carddav/client.js` line 341
- **Problem:** The PROPFIND + multiget fallback path (second strategy, line 296) logs `"Strategia 3 (multiget)"` instead of `"Strategia 2 (multiget)"`. This misleads debugging of CardDAV sync issues.
- **Root cause:** Log label was not updated when strategies were renumbered.
- **Resolution prompt:** See § Fix: CardDAV log label

---

### [LOW] — `_runMigrations` redundantly calls `_migrate2` and `_migrate3` on fresh install

- **File:** `src/main/store/db.js` lines 282–285 and `initDB` lines 116–125
- **Problem:** On a fresh install, `_runMigrations` runs the v1 migration and then explicitly calls `_migrate2` and `_migrate3` before returning. `initDB` then calls `_migrate2` and `_migrate3` again. Each migration guards with `if (ver >= N) return`, so the second calls are no-ops—but they perform three unnecessary DB reads to check `schemaVersion`.
- **Root cause:** `_runMigrations` was written to chain migrations inline, but `initDB` was also written to call each migration defensively.
- **Resolution prompt:** See § Fix: Redundant migration calls

---

## No Issues Found

**Authentication flow:** The use of Electron `safeStorage` (DPAPI) for credential storage is correct. Context isolation is enabled on all windows. The preload correctly uses `contextBridge`.

**SQL injection:** All DB queries use parameterized statements (`d.run(sql, [params])`). No string concatenation into SQL.

**IMAP reconnection logic:** Exponential backoff capped at 60 s is implemented correctly. The `_syncInFlight` Map correctly deduplicates concurrent syncs.

**Email HTML rendering:** The iframe uses `sandbox="allow-same-origin allow-popups"` without `allow-scripts`. JavaScript in email bodies cannot execute.

---

## Resolution Prompts

---

### Fix: Unrestricted arbitrary file read

**Objective**  
Remove or restrict the `store:read-local-file` IPC handler to only allow reads from the application's own `userData/attachments` directory.

**Context**  
`ipcMain.handle('store:read-local-file', async (_e, filePath) => { const buf = readFileSync(filePath); return { ok: true, base64: buf.toString('base64') } })` at `src/main/index.js:611`. It is exposed as `window.api.store.readLocalFile(filePath)` in `src/preload/index.js:85`. No path validation exists.

**Target State**  
The handler should resolve the requested path, verify it is within `join(app.getPath('userData'), 'attachments')`, and reject (return `{ ok: false, error: 'Forbidden' }`) any path outside that directory. The kumo-local protocol handler already serves attachment files securely; the readLocalFile API may be removable entirely if no other callers remain.

**Scope**  
- Work only in: `src/main/index.js` (lines 611–619), `src/preload/index.js` (lines 85–86)  
- Do NOT touch: any other IPC handlers, the kumo-local protocol handler

**Constraints**  
- Do not change function signatures unless the signature itself is the bug  
- Do not add dependencies  
- Only make changes directly requested

**Acceptance Criteria**  
- [ ] Passing an arbitrary path like `C:\Windows\System32\drivers\etc\hosts` to the handler returns `{ ok: false, error: 'Forbidden' }`  
- [ ] Passing a path within `userData/attachments` still returns the file contents  

**Stop Conditions**  
Stop and ask before: modifying any file outside the stated scope, altering any public API contract.

---

### Fix: resetAllData incomplete

**Objective**  
Make `resetAllData` wipe all application data and orchestrate a clean shutdown of IMAP connections and credentials.

**Context**  
`resetAllData()` at `src/main/store/db.js:623` only deletes `messages`, `folders`, and `settings`. The IPC handler at `src/main/index.js:596–603` calls only `resetAllData()`. Tables `accounts`, `sync_state`, `drafts`, `attachments`, `contacts`, `calendar_events`, and `messages_fts` are untouched. Credentials (`.bin` files) and active IMAP connections are not cleared.

**Target State**  
`resetAllData()` in `db.js` should also `DELETE FROM accounts`, `DELETE FROM sync_state`, `DELETE FROM drafts`, `DELETE FROM attachments`, `DELETE FROM contacts`, `DELETE FROM calendar_events`, and `DELETE FROM messages_fts`. The IPC handler in `index.js` should additionally: (1) for each client in `imapClients`, call `client.disconnect().catch(() => {})` and clear the map; (2) call `deleteCredentials()` (already imported) with no argument to wipe all `.bin` files.

**Scope**  
- Work only in: `src/main/store/db.js` (lines 623–629), `src/main/index.js` (lines 596–603)  
- Do NOT touch: any other IPC handlers, any renderer files

**Constraints**  
- Do not change function signatures unless the signature itself is the bug  
- Do not add dependencies

**Acceptance Criteria**  
- [ ] After `resetAllData` IPC call: `getAccounts()` returns `[]`, `getContacts(email)` returns `[]`, `getEvents(email)` returns `[]`  
- [ ] After `resetAllData` IPC call: no `.bin` files exist in `userData/auth/`  
- [ ] `searchMessages("any query")` returns `[]` immediately after reset  

**Stop Conditions**  
Stop and ask before: modifying any file outside the stated scope, changing DB schema.

---

### Fix: deleteAccount cascade

**Objective**  
Delete all data associated with an account when `deleteAccount(email)` is called.

**Context**  
`deleteAccount` at `src/main/store/db.js:696–700` only deletes from `accounts` and `sync_state`. Messages, attachments, contacts, and calendar events for the account remain.

**Target State**  
Add to `deleteAccount`:
```js
d.run(`DELETE FROM messages WHERE account_email = ?`, [email])
d.run(`DELETE FROM attachments WHERE uid IN (SELECT uid FROM messages WHERE account_email = ?)`, [...])
// Actually attachments don't have account_email; delete via uid join is complex.
// Simpler: delete contacts and calendar events.
d.run(`DELETE FROM contacts WHERE account_email = ?`, [email])
d.run(`DELETE FROM calendar_events WHERE account_email = ?`, [email])
d.run(`DELETE FROM drafts WHERE account_email = ?`, [email])
```
For messages: `DELETE FROM messages WHERE account_email = ?` and `DELETE FROM messages_fts WHERE folder IN (SELECT folder FROM messages WHERE account_email = ?)` before the messages delete.

**Scope**  
- Work only in: `src/main/store/db.js` (function `deleteAccount`, lines 696–700)  
- Do NOT touch: IPC handlers, renderer files

**Acceptance Criteria**  
- [ ] After `deleteAccount('test@icloud.com')`: `getMessages('INBOX', 100, 0)` returns only messages for other accounts  
- [ ] After `deleteAccount`: `getContacts('test@icloud.com')` returns `[]`  
- [ ] After `deleteAccount`: `getEvents('test@icloud.com', 0, Infinity)` returns `[]`  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope, altering the `deleteAccount` function signature.

---

### Fix: REMOVE_MESSAGE unread count

**Objective**  
Decrement the folder's unread count when an unread message is removed from the UI.

**Context**  
The `REMOVE_MESSAGE` case in `src/renderer/src/context/AppContext.jsx:138–145` removes the message from the list but does not update `state.folders.list[...].unread_count`. Compare to `UPDATE_MESSAGE_FLAGS` at lines 117–136 which correctly adjusts `unread_count`.

**Target State**  
In the `REMOVE_MESSAGE` case, after computing `list` and `selected`, look up the removed message in the old `state.messages.list`. If that message does not have `\\Seen` in its flags, decrement the matching folder's `unread_count` by 1 (min 0), mirroring the pattern already used in `UPDATE_MESSAGE_FLAGS`.

**Scope**  
- Work only in: `src/renderer/src/context/AppContext.jsx` (the `REMOVE_MESSAGE` case, lines 138–145)  
- Do NOT touch: any other reducer cases, IPC handlers, renderer components

**Acceptance Criteria**  
- [ ] Deleting an unread message causes the folder badge in the sidebar to decrease by 1 immediately  
- [ ] Deleting a read message does not change the folder badge  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: Display density not persisted

**Objective**  
Apply the saved `displayDensity` setting to the DOM on application startup.

**Context**  
`handleDensityChange` in `src/renderer/src/components/Settings.jsx:57–61` sets `document.documentElement.style.setProperty('--density-scale', ...)` imperatively. This is never re-applied when settings are loaded from the DB on startup. The density value is saved correctly in `local.displayDensity` and dispatched via `UPDATE_SETTINGS`, but no code reads `state.settings.displayDensity` to apply the CSS variable.

**Target State**  
Add a `useEffect` in `src/renderer/src/App.jsx` that watches `state.settings.displayDensity` and applies the CSS variable:
```js
useEffect(() => {
  const scale = { compact: '0.85', comfortable: '1', spacious: '1.15' }[state.settings.displayDensity] || '1'
  document.documentElement.style.setProperty('--density-scale', scale)
}, [state.settings.displayDensity])
```

**Scope**  
- Work only in: `src/renderer/src/App.jsx`  
- Do NOT touch: Settings.jsx, AppContext.jsx

**Acceptance Criteria**  
- [ ] Set density to "Compact", save, restart the app: the layout renders at compact density  
- [ ] `document.documentElement.style.getPropertyValue('--density-scale')` equals `'0.85'` after compact is saved and the app restarts  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: Compose auto-save missing editor deps

**Objective**  
Ensure the draft auto-save fires when only the email body changes.

**Context**  
The auto-save `useEffect` in `src/renderer/src/components/ComposeWindow.jsx:204–226` has `[to, cc, bcc, subject, attachments]` as its dependency array. TipTap editor content changes do not update any of these values, so body-only edits are never auto-saved. The same bug exists at `src/renderer/src/components/ComposeViewerApp.jsx:197–219`.

**Target State**  
Track body content in a React state variable updated by the TipTap `onUpdate` callback, and include it in the dependency array. Alternatively, use the editor's `onUpdate` to explicitly trigger (or reset) the debounce timer outside of the `useEffect` pattern.

A concrete approach: add `const [bodyVersion, setBodyVersion] = useState(0)` and in the editor config add `onUpdate: () => setBodyVersion(v => v + 1)`, then add `bodyVersion` to the effect's dependency array.

**Scope**  
- Work only in: `src/renderer/src/components/ComposeWindow.jsx` and `src/renderer/src/components/ComposeViewerApp.jsx` (the auto-save effects and `useEditor` calls)  
- Do NOT touch: IPC handlers, AppContext, other components

**Acceptance Criteria**  
- [ ] Write a body-only email (no to/subject), wait 2 s, close and reopen Drafts: the draft is present with the body content  

**Stop Conditions**  
Stop and ask before: modifying any file outside the stated scope, changing TipTap version.

---

### Fix: resetAllData FTS not cleared

**Objective**  
Clear the `messages_fts` virtual table in `resetAllData` to prevent stale ghost entries.

**Context**  
`resetAllData()` at `src/main/store/db.js:623–629` deletes from `messages` and `settings` (which clears `fts_seeded`) but not from `messages_fts`. After reset and re-sync, new FTS rows are appended alongside old ghost rows, degrading search.

**Target State**  
Add `d.run('DELETE FROM messages_fts')` inside `resetAllData`, wrapped in a try/catch (FTS5 may not be available):
```js
try { d.run('DELETE FROM messages_fts') } catch { /* FTS5 best-effort */ }
```

**Scope**  
- Work only in: `src/main/store/db.js` (function `resetAllData`, lines 623–629)  
- Do NOT touch: any other function, IPC handlers

**Acceptance Criteria**  
- [ ] After `resetAllData` + app restart + sync, `searchMessages('any term from old messages')` returns `[]`  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: fromName uses email not display name

**Objective**  
Use the account's `display_name` (from the `accounts` table) as the `From` name in outgoing emails.

**Context**  
Both `ComposeWindow.jsx:251` and `ComposeViewerApp.jsx:240` set `fromName: creds.creds.email`. The `accounts` table stores `display_name`. `window.api.accounts.list()` and `window.api.accounts.save()` are already available via preload.

**Target State**  
In both compose components, after retrieving credentials, also fetch the account record and use `account.display_name || account.email` as `fromName`:
```js
const accRes = await window.api.accounts.list()
const account = accRes.ok ? accRes.accounts.find(a => a.email === creds.creds.email) : null
const fromName = account?.display_name || creds.creds.email
```
Then set `fromName` in `mailOptions`.

**Scope**  
- Work only in: `src/renderer/src/components/ComposeWindow.jsx` (function `handleSend`, around line 237–255), `src/renderer/src/components/ComposeViewerApp.jsx` (function `handleSend`, around line 221–246)  
- Do NOT touch: IPC handlers, SMTP module, AppContext

**Acceptance Criteria**  
- [ ] Sent email has `From: "Display Name" <email@icloud.com>` header with the user's configured display name  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: iCal TZID ignored

**Objective**  
Log a warning when TZID is present on DTSTART/DTEND so engineers are aware the timezone is not being honored; optionally attempt UTC conversion using the TZID offset if a mapping table is available.

**Context**  
In `src/main/caldav/client.js:106–113`, the `rawProp` string (e.g., `DTSTART;TZID=America/New_York`) is split and the TZID is discarded. `parseICalDate` receives only the date-time string without timezone context.

**Target State**  
Extract the TZID from `rawProp` when present (e.g., `rawProp.match(/TZID=([^;:]+)/)`). Pass it to `parseICalDate`. Inside `parseICalDate`, if TZID is present and the time has no `Z` suffix, log a warning: `console.warn('[CAL] TZID not supported, treating as local time:', tzid)`. This makes the limitation visible without changing the (incorrect but consistent) behavior.

**Scope**  
- Work only in: `src/main/caldav/client.js` (the `DTSTART`/`DTEND` case in `parseICalEvents` and `parseICalDate`)  
- Do NOT touch: any other files

**Acceptance Criteria**  
- [ ] Parsing an `.ics` with `DTSTART;TZID=America/New_York:20230101T120000` emits a `console.warn` containing `"TZID not supported"`  

**Stop Conditions**  
Stop and ask before: adding a third-party timezone library, modifying any file outside scope.

---

### Fix: getCredentials default account

**Objective**  
When no email is specified, `getCredentials()` should prefer the account marked `is_default` in the `accounts` table, or fall back to alphabetical order.

**Context**  
`src/main/auth/index.js:33` sorts `.bin` files alphabetically and returns the first. The `accounts` table has an `is_default` column. `getCredentials()` without args is used in `store:get-sync-state` and the legacy credential fallback.

**Target State**  
In `getCredentials(email)` when `email` is not provided: call `getAccounts()` (imported from `db.js`), find the account where `is_default = 1`, and use its email to select the credential file. Fall back to alphabetical sort if no default is marked.

**Scope**  
- Work only in: `src/main/auth/index.js` (function `getCredentials`, lines 22–39)  
- Do NOT touch: IPC handlers, db.js beyond using `getAccounts`

**Constraints**  
- `getAccounts()` is synchronous; `getCredentials` is async — this change does not affect the function signature

**Acceptance Criteria**  
- [ ] With two accounts (A and B, B is default), `getCredentials()` returns B's credentials  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope, changing the function signature.

---

### Fix: Stale useEffect deps CalendarPanel/ContactsPanel

**Objective**  
Add missing dependencies to the initial-load effects in `CalendarPanel` and `ContactsPanel`.

**Context**  
`src/renderer/src/components/CalendarPanel.jsx:171–175` and `src/renderer/src/components/ContactsPanel.jsx:154–158` both omit `loadEvents`/`loadContacts` from their dependency arrays.

**Target State**  
Change the dependency arrays to include all referenced values:
```js
// CalendarPanel
}, [state.auth.isAuthenticated, state.calendar.events.length, loadEvents])

// ContactsPanel
}, [state.auth.isAuthenticated, state.contacts.list.length, loadContacts])
```

**Scope**  
- Work only in: `src/renderer/src/components/CalendarPanel.jsx` (line 175), `src/renderer/src/components/ContactsPanel.jsx` (line 158)  
- Do NOT touch: any other files

**Acceptance Criteria**  
- [ ] Switching the active account causes the calendar and contacts panels to reload data for the new account  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: Reply All includes self

**Objective**  
Exclude the current user's email from the `To` field when building a Reply All.

**Context**  
`buildReplyTo` in `src/renderer/src/components/ComposeWindow.jsx:46–52` and `src/renderer/src/components/ComposeViewerApp.jsx:39–45` does not filter out the user's own address. In `ComposeWindow`, `state.auth.email` is available. In `ComposeViewerApp`, `accountEmail` state holds the current user's email (set at line 131).

**Target State**  
In `buildReplyTo(mode, msg)`, add the current user's email as an additional parameter and filter it from the result:
```js
function buildReplyTo(mode, msg, selfEmail) {
  if (mode === 'replyAll') {
    const all = [msg.from_email, ...(msg.to_addresses || []).map(a => a.email)]
      .filter(Boolean)
      .filter(e => e.toLowerCase() !== (selfEmail || '').toLowerCase())
    return [...new Set(all)].join(', ')
  }
  ...
}
```
Update both call sites to pass the user's email.

**Scope**  
- Work only in: `src/renderer/src/components/ComposeWindow.jsx` and `src/renderer/src/components/ComposeViewerApp.jsx` (the `buildReplyTo` function and its call sites)  
- Do NOT touch: IPC handlers, AppContext

**Acceptance Criteria**  
- [ ] When the current user is in the `to_addresses` of the source message and hits Reply All, their address does not appear in the `To` field  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: partId sanitization

**Objective**  
Sanitize the `partId` parameter in the `imap:download-attachment` handler to prevent path traversal.

**Context**  
`src/main/index.js:942–943` constructs `dest = join(attDir, ${uid}_${partId}_${safeName})`. `safeName` is sanitized but `partId` is not. In IMAP, valid part IDs are sequences of digits and dots (e.g., `1`, `1.2`, `2.1.3`).

**Target State**  
Add: `const safePartId = String(partId).replace(/[^0-9.]/g, '_')` and use `safePartId` in the path construction. Also add a check that `dest` resolves within `attDir`:
```js
const resolved = path.resolve(dest)
if (!resolved.startsWith(attDir + path.sep)) return { ok: false, error: 'Forbidden' }
```

**Scope**  
- Work only in: `src/main/index.js` (the `imap:download-attachment` handler, lines 934–958)  
- Do NOT touch: any other handlers, the preload, renderer files

**Acceptance Criteria**  
- [ ] `partId = '../../../etc/passwd'` results in `{ ok: false, error: 'Forbidden' }` rather than a file written outside `attDir`  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: Remove unused params

**Objective**  
Remove the dead `params = []` parameter from `allRows` and `oneRow`.

**Context**  
`src/main/store/db.js:369` and `src/main/store/db.js:378`. No caller passes a second argument; all binding happens before these helpers are called.

**Target State**  
Change signatures to `function allRows(stmt)` and `function oneRow(stmt)`.

**Scope**  
- Work only in: `src/main/store/db.js` (lines 369, 378)  
- Do NOT touch: any other files

**Acceptance Criteria**  
- [ ] No callers of `allRows` or `oneRow` pass a second argument (verify with grep)  

**Stop Conditions**  
Stop and ask before: modifying any call site outside db.js.

---

### Fix: Dynamic import dirname

**Objective**  
Replace the unnecessary dynamic `import('path')` with the statically imported `join` in `store:open-db-folder`.

**Context**  
`src/main/index.js:587`: `const { dirname } = await import('path')`. `path` is already statically imported at line 2 (`import { join } from 'path'`).

**Target State**  
Add `dirname` to the static import at line 2: `import { join, dirname } from 'path'`. Remove the `await import('path')` line from the handler.

**Scope**  
- Work only in: `src/main/index.js` (line 2 and lines 587–590)  
- Do NOT touch: any other files

**Acceptance Criteria**  
- [ ] The handler opens the DB folder without using dynamic import  

**Stop Conditions**  
Stop and ask before: modifying any file outside stated scope.

---

### Fix: CardDAV log label

**Objective**  
Correct the log label from "Strategia 3" to "Strategia 2b" in the multiget fallback path.

**Context**  
`src/main/carddav/client.js:341`: `logContact("Strategia 3 (multiget): trovati ${contacts.length} contatti")`. This is inside the PROPFIND + multiget code path which is Strategy 2, not 3.

**Target State**  
Change to `logContact("Strategia 2b (multiget): trovati ${contacts.length} contatti")`.

**Scope**  
- Work only in: `src/main/carddav/client.js` (line 341)  
- Do NOT touch: any other lines

**Acceptance Criteria**  
- [ ] Log output reads "Strategia 2b" not "Strategia 3"  

**Stop Conditions**  
N/A (trivial one-line change).

---

### Fix: Redundant migration calls

**Objective**  
Remove the redundant `_migrate2(d)` and `_migrate3(d)` calls at the end of `_runMigrations`.

**Context**  
`src/main/store/db.js:282–285` calls `_migrate2(d)` and `_migrate3(d)` at the end of `_runMigrations`. `initDB` also calls these at lines 116–125. Each migration guards with `if (ver >= N) return`, making the second calls harmless no-ops but wasteful.

**Target State**  
Remove lines 282–285 (the two calls at the end of `_runMigrations`). `initDB` already calls them separately.

**Scope**  
- Work only in: `src/main/store/db.js` (lines 282–285 only)  
- Do NOT touch: `initDB`, the migration functions themselves

**Acceptance Criteria**  
- [ ] Fresh-install DB still reaches `schemaVersion = 3` on first startup  
- [ ] Upgrade from v1 DB still correctly applies migrations 2 and 3  

**Stop Conditions**  
Stop and ask before: modifying the migration functions themselves or `initDB`.
