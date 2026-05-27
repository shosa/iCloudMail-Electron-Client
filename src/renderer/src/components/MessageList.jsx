import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import { IconSearch, IconClose, IconAttach, IconEnvelope, IconStar } from './Icons'
import ContextMenu from './ContextMenu'

const AVATAR_COLORS = [
  '#0071e3','#5e5ebc','#bf5af2','#ff6b35',
  '#30d158','#ffd60a','#ff453a','#64d2ff'
]

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(' ')
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (email || '?').slice(0, 2).toUpperCase()
}

function formatDate(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const sameYear = date.getFullYear() === now.getFullYear()
  const diffDays = Math.floor((now - date) / 86400000)

  if (isToday)     return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' })
  if (sameYear)    return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

const FOLDER_LABEL_KEY = {
  '\\Inbox':   'folder.inbox',
  '\\Sent':    'folder.sent',
  '\\Drafts':  'folder.drafts',
  '\\Trash':   'folder.trash',
  '\\Junk':    'folder.junk',
  '\\Archive': 'folder.archive'
}

function msgKey(msg) { return `${msg.folder}-${msg.uid}` }

export default function MessageList() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const listRef = useRef(null)
  const [localSearch, setLocalSearch] = useState('')
  const searchDebounce = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')

  const folder = state.folders.selected

  function load(label) { dispatch({ type: 'SET_LOADING', payload: label }) }
  function done()      { dispatch({ type: 'CLEAR_LOADING' }) }

  const loadMessages = useCallback(async (page = 1) => {
    if (!folder) return
    load(t('loading.messages'))
    dispatch({ type: 'SET_MESSAGES_LOADING', payload: true })
    const result = await window.api.imap.fetchMessages(folder, page, 50)
    if (result.ok) dispatch({ type: 'SET_MESSAGES', payload: { ...result, page } })
    else dispatch({ type: 'SET_MESSAGES_LOADING', payload: false })
    done()
  }, [folder, dispatch])

  useEffect(() => { if (folder) loadMessages(1) }, [folder, loadMessages])
  useEffect(() => { if (state.messages._newMailSignal) loadMessages(1) }, [state.messages._newMailSignal, loadMessages])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0 }, [folder])

  // Clear multi-selection and reset filters when folder changes
  useEffect(() => { setSelectedKeys(new Set()); setFilter('all'); setSortBy('date-desc') }, [folder])

  // Ctrl+A selects all visible messages
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedKeys(new Set(displayMessages.map(msgKey)))
      }
      if (e.key === 'Escape') setSelectedKeys(new Set())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state.messages.list, state.messages.searchResults, filter, sortBy])

  function handleLoadMore() {
    if (!state.messages.hasMore || state.messages.loading) return
    loadMessages(state.messages.page + 1)
  }
  function handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.target
    if (scrollHeight - scrollTop - clientHeight < 100) handleLoadMore()
  }

  function selectSingle(msg) {
    setSelectedKeys(new Set())
    dispatch({ type: 'SELECT_MESSAGE', payload: msg })
    if (!msg.flags?.includes('\\Seen')) {
      window.api.imap.markRead(msg.folder, msg.uid, true)
      dispatch({
        type: 'UPDATE_MESSAGE_FLAGS',
        payload: { uid: msg.uid, folder: msg.folder, flags: [...(msg.flags || []), '\\Seen'] }
      })
    }
  }

  function handleItemClick(e, msg) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const k = msgKey(msg)
      setSelectedKeys(prev => {
        const next = new Set(prev)
        next.has(k) ? next.delete(k) : next.add(k)
        return next
      })
    } else {
      selectSingle(msg)
    }
  }

  function handleItemContextMenu(e, msg) {
    e.preventDefault()
    const k = msgKey(msg)
    const isInSelection = selectedKeys.has(k) && selectedKeys.size > 1
    const targetMessages = isInSelection
      ? displayMessages.filter(m => selectedKeys.has(msgKey(m)))
      : [msg]
    setContextMenu({ x: e.clientX, y: e.clientY, messages: targetMessages })
  }

  function handleSearchInput(e) {
    const q = e.target.value
    setLocalSearch(q)
    clearTimeout(searchDebounce.current)
    if (!q.trim()) { dispatch({ type: 'CLEAR_SEARCH' }); return }
    dispatch({ type: 'SET_SEARCH_QUERY', payload: q })
    searchDebounce.current = setTimeout(async () => {
      load(t('loading.searching'))
      const lr = await window.api.store.searchLocal(q)
      if (lr.ok) dispatch({ type: 'SET_SEARCH_RESULTS', payload: lr.results })
      const sr = await window.api.imap.search(folder, q)
      if (sr.ok && sr.results?.length) {
        const combined = [
          ...(lr.results || []),
          ...sr.results.filter(s => !(lr.results || []).some(l => l.uid === s.uid && l.folder === s.folder))
        ]
        dispatch({ type: 'SET_SEARCH_RESULTS', payload: combined })
      }
      done()
    }, 400)
  }

  function clearSearch() {
    setLocalSearch('')
    dispatch({ type: 'CLEAR_SEARCH' })
  }

  function handleContextAction(type, messages, data) {
    const folder0 = messages[0].folder
    const uids = messages.map(m => m.uid)
    const msg = messages[0]

    switch (type) {
      case 'reply':
        dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'reply', message: msg } })
        break
      case 'replyAll':
        dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'replyAll', message: msg } })
        break
      case 'forward':
        dispatch({ type: 'OPEN_COMPOSE', payload: { mode: 'forward', message: msg } })
        break

      case 'markRead':
        messages.forEach(m => dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: m.uid, folder: m.folder, flags: [...(m.flags || []), '\\Seen'] } }))
        window.api.imap.bulkSetFlag(folder0, uids, '\\Seen', true)
        break
      case 'markUnread':
        messages.forEach(m => dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: m.uid, folder: m.folder, flags: (m.flags || []).filter(f => f !== '\\Seen') } }))
        window.api.imap.bulkSetFlag(folder0, uids, '\\Seen', false)
        break
      case 'star':
        messages.forEach(m => dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: m.uid, folder: m.folder, flags: [...(m.flags || []), '\\Flagged'] } }))
        window.api.imap.bulkSetFlag(folder0, uids, '\\Flagged', true)
        break
      case 'unstar':
        messages.forEach(m => dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: m.uid, folder: m.folder, flags: (m.flags || []).filter(f => f !== '\\Flagged') } }))
        window.api.imap.bulkSetFlag(folder0, uids, '\\Flagged', false)
        break
      case 'move':
        messages.forEach(m => dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: m.uid, folder: m.folder } }))
        setSelectedKeys(new Set())
        window.api.imap.bulkMove(folder0, uids, data)
        break
      case 'junk':
        messages.forEach(m => dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: m.uid, folder: m.folder } }))
        setSelectedKeys(new Set())
        Promise.all(messages.map(m => window.api.imap.markJunk(m.folder, m.uid, true)))
        break
      case 'delete':
        messages.forEach(m => dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: m.uid, folder: m.folder } }))
        setSelectedKeys(new Set())
        window.api.imap.bulkDelete(folder0, uids)
        break
    }
  }

  const folderObj = state.folders.list.find(f => f.path === folder)
  const folderName = folderObj
    ? (folderObj.special_use && FOLDER_LABEL_KEY[folderObj.special_use]
        ? t(FOLDER_LABEL_KEY[folderObj.special_use])
        : (folderObj.name || folder?.split('/').pop() || folder || ''))
    : (folder?.split('/').pop() || folder || '')

  const rawMessages = state.messages.searchResults !== null
    ? state.messages.searchResults : state.messages.list

  const filteredMessages = filter === 'unread'
    ? rawMessages.filter(m => !m.flags?.includes('\\Seen'))
    : filter === 'starred'
      ? rawMessages.filter(m => m.flags?.includes('\\Flagged'))
      : rawMessages

  const displayMessages = [...filteredMessages].sort((a, b) => {
    if (sortBy === 'date-asc') return (a.date || 0) - (b.date || 0)
    if (sortBy === 'from')    return (a.from_name || a.from_email || '').localeCompare(b.from_name || b.from_email || '')
    if (sortBy === 'subject') return (a.subject || '').localeCompare(b.subject || '')
    return (b.date || 0) - (a.date || 0)
  })

  const primaryUid = state.messages.selected?.uid

  return (
    <div className="message-list" onClick={e => { if (!e.defaultPrevented) setContextMenu(null) }}>
      <div className="message-list__header">
        <div className="message-list__title">
          {state.messages.searchResults !== null ? `Search: "${localSearch}"` : folderName}
          {' '}
          {!state.messages.searchResults && state.messages.total > 0 && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontWeight: 'var(--weight-regular)' }}>
              {state.messages.total}
            </span>
          )}
          {selectedKeys.size > 1 && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 'var(--weight-medium)', marginLeft: 'var(--sp-2)' }}>
              · {t('multiselect.count', selectedKeys.size)}
            </span>
          )}
        </div>

        <div className="search-bar">
          <span className="search-bar__icon"><IconSearch size={14} /></span>
          <input
            className="search-bar__input"
            placeholder={t('messages.searchPlaceholder')}
            value={localSearch}
            onChange={handleSearchInput}
          />
          {localSearch && (
            <button className="search-bar__clear" onClick={clearSearch}>
              <IconClose size={12} />
            </button>
          )}
        </div>
      </div>

      {!state.messages.searchResults && (
        <div className="message-list__filters">
          <div className="filter-tabs">
            {['all', 'unread', 'starred'].map(f => (
              <button key={f} className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                {t(`filter.${f}`)}
              </button>
            ))}
          </div>
          <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="date-desc">{t('sort.newest')}</option>
            <option value="date-asc">{t('sort.oldest')}</option>
            <option value="from">{t('sort.from')}</option>
            <option value="subject">{t('sort.subject')}</option>
          </select>
        </div>
      )}

      {state.messages.loading && displayMessages.length === 0 ? (
        <div className="message-list__empty"><div className="spinner" /></div>
      ) : displayMessages.length === 0 ? (
        <div className="message-list__empty">
          <IconEnvelope size={40} style={{ opacity: 0.25, color: 'var(--text-tertiary)' }} />
          <span>{localSearch ? t('messages.noResults') : t('messages.noMessages')}</span>
        </div>
      ) : (
        <div className="message-list__body" ref={listRef} onScroll={handleScroll}>
          {displayMessages.map(msg => (
            <MessageItem
              key={msgKey(msg)}
              message={msg}
              selected={primaryUid === msg.uid && selectedKeys.size === 0}
              multiSelected={selectedKeys.has(msgKey(msg))}
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

          {state.messages.hasMore && !state.messages.searchResults && (
            <div className="message-list__load-more">
              {state.messages.loading ? (
                <div className="spinner" style={{ margin: '0 auto' }} />
              ) : (
                <button className="btn btn--ghost" onClick={handleLoadMore}>
                  {t('action.loadMore')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messages={contextMenu.messages}
          folders={state.folders.list}
          onClose={() => setContextMenu(null)}
          onAction={(type, data) => handleContextAction(type, contextMenu.messages, data)}
        />
      )}
    </div>
  )
}

function MessageItem({ message, selected, multiSelected, onClick, onDoubleClick, onContextMenu, onDragStart }) {
  const isUnread  = !message.flags?.includes('\\Seen')
  const isStarred = message.flags?.includes('\\Flagged')
  const initials  = getInitials(message.from_name, message.from_email)
  const color     = getAvatarColor(message.from_name || message.from_email)

  return (
    <div
      className={`message-item${selected ? ' selected' : ''}${isUnread ? ' unread' : ''}${multiSelected ? ' multi-selected' : ''}`}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(e)}
    >
      <div
        className="message-item__avatar"
        style={{ backgroundColor: multiSelected ? 'var(--accent)' : color }}
      >
        {multiSelected ? '✓' : initials}
      </div>

      <div className="message-item__content">
        <div className="message-item__row1">
          <span className="message-item__sender">
            {message.from_name || message.from_email || '(Unknown)'}
          </span>
          {isStarred && !multiSelected && <IconStar size={12} style={{ color: '#ffd60a', fill: '#ffd60a', flexShrink: 0 }} />}
          <span className="message-item__time">{formatDate(message.date)}</span>
        </div>
        <div className="message-item__subject truncate">
          {message.subject || '(No subject)'}
        </div>
        <div className="message-item__preview">
          {message.has_attachments && <span className="message-item__attachments-icon"><IconAttach size={12} /></span>}
          <span className="truncate">{message.snippet}</span>
        </div>
      </div>
    </div>
  )
}
