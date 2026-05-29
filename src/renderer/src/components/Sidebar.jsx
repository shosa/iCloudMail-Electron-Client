import React, { useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import {
  IconInbox, IconSent, IconDrafts, IconTrash, IconJunk,
  IconArchive, IconFolder, IconCompose, IconSettings, IconRefresh,
  IconSignOut, IconMarkRead, IconNoSymbol, IconMail, IconContacts, IconCalendar
} from './Icons'

const FOLDER_ICON_MAP = {
  '\\Inbox':   IconInbox,
  '\\Sent':    IconSent,
  '\\Drafts':  IconDrafts,
  '\\Trash':   IconTrash,
  '\\Junk':    IconJunk,
  '\\Archive': IconArchive
}

const FOLDER_LABEL_KEY = {
  '\\Inbox':   'folder.inbox',
  '\\Sent':    'folder.sent',
  '\\Drafts':  'folder.drafts',
  '\\Trash':   'folder.trash',
  '\\Junk':    'folder.junk',
  '\\Archive': 'folder.archive'
}

const SPECIAL_ORDER = {
  '\\Inbox': 0, '\\Sent': 1, '\\Drafts': 2, '\\Junk': 3, '\\Trash': 4, '\\Archive': 5
}

function folderSortKey(f) {
  return (f.special_use && SPECIAL_ORDER[f.special_use] !== undefined)
    ? SPECIAL_ORDER[f.special_use] : 99
}

// ── Avatar menu ───────────────────────────────────────────────────────────────

function AvatarMenu({ anchorRect, email, onClose, onSettings, onSignOut, t }) {
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x: anchorRect?.left || 0, y: anchorRect?.top || 0 })

  useEffect(() => {
    if (!menuRef.current || !anchorRect) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    let x = anchorRect.left
    let y = anchorRect.top - rect.height - 8
    if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8)
    if (y < 8) y = anchorRect.bottom + 8
    setPos({ x, y })
  }, [anchorRect])

  useEffect(() => {
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose() }
    const esc   = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [onClose])

  return (
    <div ref={menuRef} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      <div className="context-menu__header" style={{ userSelect: 'text' }}>{email}</div>
      <div className="context-menu__separator" />
      <div className="context-menu__item" onClick={onSettings} role="menuitem">
        <span className="context-menu__icon"><IconSettings size={15} /></span>
        <span>{t('sidebar.settings')}</span>
      </div>
      <div className="context-menu__separator" />
      <div className="context-menu__item context-menu__item--danger" onClick={onSignOut} role="menuitem">
        <span className="context-menu__icon"><IconSignOut size={15} /></span>
        <span>{t('sidebar.signOut')}</span>
      </div>
    </div>
  )
}

// ── Folder context menu ──────────────────────────────────────────────────────

function FolderMenu({ x, y, folder, onClose, onAction }) {
  const t = useTranslation()
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    setPos({
      x: x + rect.width > vw - 8 ? Math.max(8, vw - rect.width - 8) : x,
      y: y + rect.height > vh - 8 ? Math.max(8, vh - rect.height - 8) : y
    })
  }, [x, y])

  useEffect(() => {
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose() }
    const esc = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const isTrash = folder.special_use === '\\Trash'
  const isJunk  = folder.special_use === '\\Junk'
  const canEmpty = isTrash || isJunk

  const labelKey = FOLDER_LABEL_KEY[folder.special_use]
  const folderName = labelKey ? t(labelKey) : (folder.name || folder.path.split('/').pop())

  function act(type) { onAction(type); onClose() }

  return (
    <div ref={menuRef} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      <div className="context-menu__header">{folderName}</div>
      <div className="context-menu__separator" />
      <div className="context-menu__item" onClick={() => act('markAllRead')} role="menuitem">
        <span className="context-menu__icon"><IconMarkRead size={15} /></span>
        <span>{t('folder.markAllRead')}</span>
      </div>
      <div className="context-menu__item" onClick={() => act('refresh')} role="menuitem">
        <span className="context-menu__icon"><IconRefresh size={15} /></span>
        <span>{t('folder.refresh')}</span>
      </div>
      {canEmpty && (
        <>
          <div className="context-menu__separator" />
          <div className="context-menu__item context-menu__item--danger" onClick={() => act('empty')} role="menuitem">
            <span className="context-menu__icon"><IconNoSymbol size={15} /></span>
            <span>{isTrash ? t('folder.emptyTrash') : t('folder.emptyJunk')}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const [folderMenu, setFolderMenu] = useState(null)
  const [avatarMenu, setAvatarMenu] = useState(false)
  const avatarRef = useRef(null)
  const [dragOverPath, setDragOverPath] = useState(null)

  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])

  const loadFolders = useCallback(async () => {
    dispatch({ type: 'SET_FOLDERS_LOADING', payload: true })
    dispatch({ type: 'SET_LOADING', payload: tRef.current('loading.folders') })
    const result = await window.api.imap.getFolders()
    if (result.ok) {
      dispatch({ type: 'SET_FOLDERS', payload: result.folders })
    } else {
      dispatch({ type: 'SET_FOLDERS_LOADING', payload: false })
    }
    dispatch({ type: 'CLEAR_LOADING' })
  }, [dispatch])

  // Load from cache immediately when authenticated
  useEffect(() => {
    if (!state.auth.isAuthenticated) return
    window.api.store.getCachedFolders().then(result => {
      if (result.ok && result.folders?.length > 0) {
        dispatch({ type: 'SET_FOLDERS', payload: result.folders })
      }
    })
  }, [state.auth.isAuthenticated, dispatch])

  // Refresh from IMAP when connection is established
  useEffect(() => {
    if (state.connectionStatus === 'connected') loadFolders()
  }, [state.connectionStatus, loadFolders])

  function selectFolder(path) {
    if (path === state.folders.selected) return
    dispatch({ type: 'SELECT_FOLDER', payload: path })
  }

  function openCompose()  { window.api.window.openCompose({ mode: 'new' }) }
  function openSettings() { dispatch({ type: 'TOGGLE_SETTINGS' }) }
  function signOut() {
    window.api.auth.deleteCredentials()
    window.api.imap.disconnect()
    dispatch({ type: 'SET_UNAUTHENTICATED' })
  }

  async function syncSelectedFolder() {
    if (state.folders.selected) {
      await window.api.imap.syncFolder(state.folders.selected)
    }
  }

  async function handleFolderAction(folder, type) {
    switch (type) {
      case 'markAllRead':
        dispatch({ type: 'SET_LOADING', payload: t('loading.marking') })
        await window.api.imap.markAllRead(folder.path)
        dispatch({ type: 'CLEAR_LOADING' })
        loadFolders()
        break
      case 'refresh':
        await loadFolders()
        await syncSelectedFolder()
        break
      case 'empty':
        dispatch({ type: 'SET_LOADING', payload: t('loading.deleting') })
        await window.api.imap.emptyFolder(folder.path)
        dispatch({ type: 'CLEAR_LOADING' })
        // Clear messages if this folder is selected
        if (state.folders.selected === folder.path) {
          dispatch({ type: 'SET_MESSAGES', payload: { messages: [], total: 0, page: 1, hasMore: false } })
        }
        break
    }
  }

  function handleFolderDrop(targetFolder, e) {
    e.preventDefault()
    setDragOverPath(null)
    const raw = e.dataTransfer.getData('x-mail-messages')
    if (!raw) return
    let messages
    try { messages = JSON.parse(raw) } catch { return }
    const byFolder = {}
    messages.forEach(m => {
      if (m.folder === targetFolder.path) return
      ;(byFolder[m.folder] = byFolder[m.folder] || []).push(m.uid)
    })
    Object.entries(byFolder).forEach(([srcFolder, uids]) => {
      uids.forEach(uid => dispatch({ type: 'REMOVE_MESSAGE', payload: { uid, folder: srcFolder } }))
      window.api.imap.bulkMove(srcFolder, uids, targetFolder.path)
    })
  }

  const sorted = [...state.folders.list].sort((a, b) => folderSortKey(a) - folderSortKey(b))
  const systemFolders = sorted.filter(f => f.special_use)
  const customFolders = sorted.filter(f => !f.special_use)
  const initials = state.auth.email ? state.auth.email.slice(0, 2).toUpperCase() : '?'

  const currentView = state.view || 'mail'

  return (
    <div className="sidebar" onClick={() => { setFolderMenu(null); setAvatarMenu(false) }}>
      <div className="sidebar__folders">
        {currentView !== 'mail' ? (
          <>
            <div className="sidebar__section-label">iCloud</div>
            <div className="folder-item active" style={{ cursor: 'default' }}>
              <span className="folder-item__icon">
                {currentView === 'contacts' ? <IconContacts size={16} /> : <IconCalendar size={16} />}
              </span>
              <span className="folder-item__name">Principale</span>
            </div>
          </>
        ) : null}

        {currentView === 'mail' && state.folders.loading && state.folders.list.length === 0 && (
          <div style={{ padding: 'var(--sp-4)', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        )}

        {currentView === 'mail' && systemFolders.length > 0 && (
          <>
            <div className="sidebar__section-label">{t('sidebar.mailboxes')}</div>
            {systemFolders.map(folder => (
              <FolderItem
                key={folder.path}
                folder={folder}
                selected={state.folders.selected === folder.path}
                dragOver={dragOverPath === folder.path}
                onClick={() => selectFolder(folder.path)}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setFolderMenu({ x: e.clientX, y: e.clientY, folder }) }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverPath(folder.path) }}
                onDragLeave={() => setDragOverPath(null)}
                onDrop={e => handleFolderDrop(folder, e)}
                t={t}
              />
            ))}
          </>
        )}

        {currentView === 'mail' && customFolders.length > 0 && (
          <>
            <div className="sidebar__section-label" style={{ marginTop: 'var(--sp-3)' }}>
              {t('sidebar.folders')}
            </div>
            {customFolders.map(folder => (
              <FolderItem
                key={folder.path}
                folder={folder}
                selected={state.folders.selected === folder.path}
                dragOver={dragOverPath === folder.path}
                onClick={() => selectFolder(folder.path)}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setFolderMenu({ x: e.clientX, y: e.clientY, folder }) }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverPath(folder.path) }}
                onDragLeave={() => setDragOverPath(null)}
                onDrop={e => handleFolderDrop(folder, e)}
                t={t}
              />
            ))}
          </>
        )}
      </div>

      <div className="sidebar__nav-tabs">
        <span
          className="sidebar__nav-indicator"
          style={{ transform: `translateX(calc(${({ mail: 0, contacts: 1, calendar: 2 }[state.view || 'mail'] ?? 0)} * (100% + 1px)))` }}
        />
        <button
          className={`sidebar__nav-tab${state.view === 'mail' || !state.view ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: 'mail' })}
          title={t('nav.mail')}
          aria-label={t('nav.mail')}
        >
          <IconMail size={20} />
        </button>
        <button
          className={`sidebar__nav-tab${state.view === 'contacts' ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: 'contacts' })}
          title={t('nav.contacts')}
          aria-label={t('nav.contacts')}
        >
          <IconContacts size={20} />
        </button>
        <button
          className={`sidebar__nav-tab${state.view === 'calendar' ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: 'calendar' })}
          title={t('nav.calendar')}
          aria-label={t('nav.calendar')}
        >
          <IconCalendar size={20} />
        </button>
      </div>

      <div className="sidebar__loading-bar">
        <div className="sidebar__loading-bar__label">
          {state.loading.label || ''}
        </div>
        <div className="sidebar__loading-bar__track">
          {(state.folders.loading || state.loading.active) && (
            <div className="sidebar__loading-bar__fill" />
          )}
        </div>
      </div>

      <div className="sidebar__footer">
        <div
          ref={avatarRef}
          className={`sidebar__footer-avatar${avatarMenu ? ' active' : ''}`}
          onClick={e => { e.stopPropagation(); setAvatarMenu(v => !v) }}
          title={state.auth.email}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setAvatarMenu(v => !v)}
        >{initials}</div>
        <span style={{ flex: 1 }} />
        <button className="btn btn--icon" onClick={async () => { await loadFolders(); await syncSelectedFolder() }} title={t('sidebar.refresh')}>
          <IconRefresh size={16} />
        </button>
      </div>

      {avatarMenu && createPortal(
        <AvatarMenu
          anchorRect={avatarRef.current?.getBoundingClientRect()}
          email={state.auth.email}
          onClose={() => setAvatarMenu(false)}
          onSettings={() => { openSettings(); setAvatarMenu(false) }}
          onSignOut={() => { signOut(); setAvatarMenu(false) }}
          t={t}
        />,
        document.querySelector('.app-root') || document.body
      )}

      {folderMenu && createPortal(
        <FolderMenu
          x={folderMenu.x}
          y={folderMenu.y}
          folder={folderMenu.folder}
          onClose={() => setFolderMenu(null)}
          onAction={type => handleFolderAction(folderMenu.folder, type)}
        />,
        document.querySelector('.app-root') || document.body
      )}
    </div>
  )
}

function FolderItem({ folder, selected, dragOver, onClick, onContextMenu, onDragOver, onDragLeave, onDrop, t }) {
  const IconComp = FOLDER_ICON_MAP[folder.special_use] || IconFolder
  const labelKey = FOLDER_LABEL_KEY[folder.special_use]
  const name = labelKey ? t(labelKey) : (folder.name || folder.path.split('/').pop())

  return (
    <div
      className={`folder-item${selected ? ' active' : ''}${dragOver ? ' drag-over' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      aria-label={`${name}${folder.unread_count > 0 ? `, ${folder.unread_count} unread` : ''}`}
    >
      <span className="folder-item__icon"><IconComp size={16} /></span>
      <span className="folder-item__name">{name}</span>
      {folder.unread_count > 0 && (
        <span className="folder-item__badge">
          {folder.unread_count > 99 ? '99+' : folder.unread_count}
        </span>
      )}
    </div>
  )
}
