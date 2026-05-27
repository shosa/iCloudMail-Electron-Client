import React, { useEffect } from 'react'
import { useAppState, useAppDispatch } from './context/AppContext'
import SetupScreen from './components/SetupScreen'
import Sidebar from './components/Sidebar'
import MessageList from './components/MessageList'
import ReadingPane from './components/ReadingPane'
import ComposeWindow from './components/ComposeWindow'
import Settings from './components/Settings'
import TitleBar from './components/TitleBar'

export default function App() {
  const state = useAppState()
  const dispatch = useAppDispatch()

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
      dispatch({ type: 'OPEN_COMPOSE', payload: data })
    })
    const offSync = window.api.on('imap:sync-complete', ({ folder, newCount }) => {
      if (newCount > 0) {
        dispatch({ type: 'SYNC_COMPLETE', payload: { folder, newCount } })
      }
    })
    const offNotifClick = window.api.on('imap:notification-click', ({ folder }) => {
      dispatch({ type: 'SELECT_FOLDER', payload: folder })
    })

    return () => {
      offNewMail?.()
      offStatus?.()
      offCompose?.()
      offSync?.()
      offNotifClick?.()
    }
  }, [dispatch])

  if (!state.auth.isAuthenticated) {
    return (
      <div className="app-root">
        <TitleBar />
        <SetupScreen />
      </div>
    )
  }

  return (
    <div className={`app-root theme-${state.settings.theme || 'dark'}`}>
      <TitleBar connectionStatus={state.connectionStatus} />
      <div className="app-layout">
        <Sidebar />
        <MessageList />
        <ReadingPane />
      </div>
      {state.compose.isOpen && <ComposeWindow />}
      {state.settings.panelOpen && <Settings />}
    </div>
  )
}
