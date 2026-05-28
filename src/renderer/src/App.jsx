import React, { useEffect, useRef, useCallback } from 'react'
import { useAppState, useAppDispatch } from './context/AppContext'
import SetupScreen from './components/SetupScreen'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import MessageList from './components/MessageList'
import ReadingPane from './components/ReadingPane'
import ContactsPanel from './components/ContactsPanel'
import CalendarPanel from './components/CalendarPanel'
import ComposeWindow from './components/ComposeWindow'
import Settings from './components/Settings'
import TitleBar from './components/TitleBar'

const SIDEBAR_MIN  = 180
const SIDEBAR_MAX  = 320
const MSGLIST_MIN  = 220
const MSGLIST_MAX  = 480

function loadWidths() {
  try {
    return {
      sidebar:  parseInt(localStorage.getItem('pane-sidebar')  || '220', 10),
      msglist:  parseInt(localStorage.getItem('pane-msglist')  || '300', 10)
    }
  } catch { return { sidebar: 220, msglist: 300 } }
}

function saveWidth(key, value) {
  try { localStorage.setItem(`pane-${key}`, String(value)) } catch { /* ignore */ }
}

function useResizeHandle(containerRef, key, min, max, onResize) {
  const dragging = useRef(false)
  const startX   = useRef(0)
  const startW   = useRef(0)

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = containerRef.current
      ? containerRef.current.getBoundingClientRect().width
      : (min + max) / 2
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [containerRef, min, max])

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current) return
      const delta = e.clientX - startX.current
      const newW = Math.min(max, Math.max(min, startW.current + delta))
      if (containerRef.current) containerRef.current.style.width = `${newW}px`
      onResize(newW)
    }
    function onMouseUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (containerRef.current) {
        const w = parseInt(containerRef.current.style.width || '0', 10)
        saveWidth(key, w)
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [containerRef, key, min, max, onResize])

  return onMouseDown
}

export default function App() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const view = state.view || 'mail'

  const widths = useRef(loadWidths())
  const sidebarRef  = useRef(null)
  const msglistRef  = useRef(null)

  // Apply stored widths on mount
  useEffect(() => {
    if (sidebarRef.current)  sidebarRef.current.style.width  = `${widths.current.sidebar}px`
    if (msglistRef.current)  msglistRef.current.style.width  = `${widths.current.msglist}px`
  }, [])

  const onSidebarResize = useCallback(w => { widths.current.sidebar = w }, [])
  const onMsglistResize = useCallback(w => { widths.current.msglist = w }, [])

  const onSidebarDrag  = useResizeHandle(sidebarRef,  'sidebar',  SIDEBAR_MIN,  SIDEBAR_MAX,  onSidebarResize)
  const onMsglistDrag  = useResizeHandle(msglistRef,  'msglist',  MSGLIST_MIN,  MSGLIST_MAX,  onMsglistResize)

  // Keep taskbar/tray badge in sync with local unread counts
  useEffect(() => {
    const total = state.folders.list.reduce((sum, f) => sum + (f.unread_count || 0), 0)
    window.api.window.setBadge(total)
  }, [state.folders.list])

  // Restore display density from settings
  useEffect(() => {
    const scale = { compact: '0.85', comfortable: '1', spacious: '1.15' }[state.settings.displayDensity] || '1'
    document.documentElement.style.setProperty('--density-scale', scale)
  }, [state.settings.displayDensity])

  // System theme sync
  useEffect(() => {
    if (state.settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function apply(e) {
      document.documentElement.dataset.systemTheme = e.matches ? 'dark' : 'light'
    }
    apply(mq)
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [state.settings.theme])

  // IPC event listeners
  useEffect(() => {
    const offNewMail = window.api.on('imap:new-mail', (data) => {
      dispatch({ type: 'NEW_MAIL', payload: data })
    })
    const offStatus = window.api.on('imap:connection-status', (status) => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: status })
      if (status === 'connecting' || status === 'reconnecting') {
        dispatch({ type: 'SET_LOADING', payload: status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…' })
      } else {
        dispatch({ type: 'CLEAR_LOADING' })
      }
    })
    const offCompose = window.api.on('open-compose', (data) => {
      window.api.window.openCompose(data || { mode: 'new' })
    })
    const offSync = window.api.on('imap:sync-complete', ({ folder, newCount, removedCount }) => {
      dispatch({ type: 'SYNC_COMPLETE', payload: { folder, newCount, removedCount } })
    })
    const offFlags = window.api.on('imap:flags-updated', ({ folder, uid, flags }) => {
      dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { folder, uid, flags } })
    })
    const offNotifClick = window.api.on('imap:notification-click', ({ folder }) => {
      dispatch({ type: 'SELECT_FOLDER', payload: folder })
    })
    return () => {
      offNewMail?.(); offStatus?.(); offCompose?.()
      offSync?.(); offFlags?.(); offNotifClick?.()
    }
  }, [dispatch])

  // Keyboard shortcuts
  useEffect(() => {
    if (!state.auth.isAuthenticated) return
    function onKeyDown(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.target.contentEditable === 'true') return
      switch (e.key) {
        case 'c':
          window.api.window.openCompose({ mode: 'new' })
          break
        case 'r':
          if (state.messages.selected) {
            window.api.window.openCompose({ mode: 'reply', message: state.messages.selected })
          }
          break
        case 'Escape':
          if (state.compose.isOpen) dispatch({ type: 'CLOSE_COMPOSE' })
          else if (state.settings?.panelOpen) dispatch({ type: 'CLOSE_SETTINGS' })
          break
        case 'Delete':
        case 'Backspace':
          if (state.messages.selected && !state.compose.isOpen && view === 'mail') {
            const msg = state.messages.selected
            dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: msg.uid, folder: msg.folder } })
            window.api.imap.deleteMessage(msg.folder, msg.uid, false)
          }
          break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state.auth.isAuthenticated, state.compose.isOpen, state.settings?.panelOpen, state.messages.selected, view, dispatch])

  const resolvedTheme = (() => {
    if (state.settings.theme === 'system') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } catch { return 'light' }
    }
    return state.settings.theme || 'light'
  })()

  if (!state.auth.isAuthenticated) {
    return (
      <div className="app-root theme-light">
        <TitleBar />
        <SetupScreen />
      </div>
    )
  }

  return (
    <div className={`app-root theme-${resolvedTheme}`}>
      <TitleBar connectionStatus={state.connectionStatus} />
      <Toolbar />
      <div className="app-layout">
        <div className="app-layout__sidebar" ref={sidebarRef}>
          <Sidebar />
        </div>
        <div
          className="resize-handle resize-handle--vertical"
          onMouseDown={onSidebarDrag}
          title="Drag to resize"
        />
        {view === 'mail' && (
          <>
            <div className="app-layout__msglist" ref={msglistRef}>
              <MessageList />
            </div>
            <div
              className="resize-handle resize-handle--vertical"
              onMouseDown={onMsglistDrag}
              title="Drag to resize"
            />
            <div className="app-layout__reading">
              <ReadingPane />
            </div>
          </>
        )}
        {view === 'contacts' && (
          <div className="app-layout__full">
            <ContactsPanel />
          </div>
        )}
        {view === 'calendar' && (
          <div className="app-layout__full">
            <CalendarPanel />
          </div>
        )}
      </div>
      {state.compose.isOpen && <ComposeWindow />}
      {state.settings.panelOpen && <Settings />}
    </div>
  )
}
