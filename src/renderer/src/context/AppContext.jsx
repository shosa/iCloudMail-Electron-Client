import React, { createContext, useContext, useReducer, useEffect } from 'react'

const StateCtx = createContext(null)
const DispatchCtx = createContext(null)

const initialState = {
  auth: {
    isAuthenticated: false,
    email: null
  },
  connectionStatus: 'disconnected',
  folders: {
    list: [],
    selected: 'INBOX',
    loading: false
  },
  messages: {
    list: [],
    selected: null,
    loading: false,
    hasMore: false,
    page: 1,
    total: 0,
    searchQuery: '',
    searchResults: null,
    pendingNotifUid: null
  },
  compose: {
    isOpen: false,
    mode: null, // 'new' | 'reply' | 'replyAll' | 'forward'
    referencedMessage: null
  },
  settings: {
    panelOpen: false,
    theme: 'light',
    blockRemoteImages: true,
    notificationsEnabled: true,
    syncMode: 'idle',
    syncInterval: 5,
    signature: '',
    notifyFolders: ['INBOX'],
    language: 'en-US'
  },
  view: 'mail',        // 'mail' | 'contacts' | 'calendar'
  contacts: {
    list: [],
    loading: false,
    searchQuery: '',
    selected: null,
    syncing: false
  },
  calendar: {
    events: [],
    loading: false,
    syncing: false
  },
  notifications: [],
  loading: { active: false, label: '' },
  sync: {
    // Global sync state tracking for animation
    operationsInProgress: 0,  // Count of active sync operations
    lastActivity: null        // Timestamp of last sync activity
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_AUTHENTICATED':
      return {
        ...state,
        auth: { isAuthenticated: true, email: action.payload }
      }
    case 'SET_UNAUTHENTICATED':
      return {
        ...state,
        auth: { isAuthenticated: false, email: null },
        connectionStatus: 'disconnected'
      }
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload }

    // Folders
    case 'SET_FOLDERS':
      return { ...state, folders: { ...state.folders, list: action.payload, loading: false } }
    case 'SET_FOLDERS_LOADING':
      return { ...state, folders: { ...state.folders, loading: action.payload } }
    case 'SELECT_FOLDER':
      return {
        ...state,
        folders: { ...state.folders, selected: action.payload },
        messages: { ...state.messages, list: [], page: 1, selected: null, searchQuery: '', searchResults: null }
      }
    case 'UPDATE_FOLDER_UNREAD': {
      const list = state.folders.list.map(f =>
        f.path === action.payload.path ? { ...f, unread_count: action.payload.count } : f
      )
      return { ...state, folders: { ...state.folders, list } }
    }
    case 'NOTIF_OPEN_MAIL':
      return {
        ...state,
        folders: { ...state.folders, selected: action.payload.folder },
        messages: { ...state.messages, list: [], page: 1, selected: null, searchQuery: '', searchResults: null, pendingNotifUid: action.payload.uid }
      }
    case 'CLEAR_NOTIF_TARGET':
      return { ...state, messages: { ...state.messages, pendingNotifUid: null } }

    // Messages
    case 'SET_MESSAGES':
      return {
        ...state,
        messages: {
          ...state.messages,
          list: action.payload.page === 1
            ? action.payload.messages
            : [...state.messages.list, ...action.payload.messages],
          hasMore: action.payload.hasMore,
          total: action.payload.total,
          page: action.payload.page,
          loading: false
        }
      }
    case 'SET_MESSAGES_LOADING':
      return { ...state, messages: { ...state.messages, loading: action.payload } }
    case 'SELECT_MESSAGE':
      return { ...state, messages: { ...state.messages, selected: action.payload } }
    case 'UPDATE_MESSAGE_FLAGS': {
      const prev = state.messages.list.find(m => m.uid === action.payload.uid && m.folder === action.payload.folder)
      const list = state.messages.list.map(m =>
        m.uid === action.payload.uid && m.folder === action.payload.folder
          ? { ...m, flags: action.payload.flags }
          : m
      )
      // Keep folder unread_count in sync with local flag changes
      const wasRead = prev?.flags?.includes('\\Seen')
      const nowRead = action.payload.flags?.includes('\\Seen')
      let folderList = state.folders.list
      if (wasRead !== nowRead && action.payload.folder) {
        const delta = nowRead ? -1 : 1
        folderList = state.folders.list.map(f =>
          f.path === action.payload.folder
            ? { ...f, unread_count: Math.max(0, (f.unread_count || 0) + delta) }
            : f
        )
      }
      const selected = state.messages.selected?.uid === action.payload.uid &&
        state.messages.selected?.folder === action.payload.folder
        ? { ...state.messages.selected, flags: action.payload.flags }
        : state.messages.selected
      return { ...state, messages: { ...state.messages, list, selected }, folders: { ...state.folders, list: folderList } }
    }
    case 'REMOVE_MESSAGE': {
      const removed = state.messages.list.find(
        m => m.uid === action.payload.uid && m.folder === action.payload.folder
      )
      const list = state.messages.list.filter(
        m => !(m.uid === action.payload.uid && m.folder === action.payload.folder)
      )
      const selected = state.messages.selected?.uid === action.payload.uid
        ? null : state.messages.selected
      const wasUnread = removed && !removed.flags?.includes('\\Seen')
      const folderList = wasUnread && action.payload.folder
        ? state.folders.list.map(f =>
            f.path === action.payload.folder
              ? { ...f, unread_count: Math.max(0, (f.unread_count || 0) - 1) }
              : f
          )
        : state.folders.list
      return { ...state, messages: { ...state.messages, list, selected }, folders: { ...state.folders, list: folderList } }
    }
    case 'SET_SEARCH_QUERY':
      return { ...state, messages: { ...state.messages, searchQuery: action.payload } }
    case 'SET_SEARCH_RESULTS':
      return { ...state, messages: { ...state.messages, searchResults: action.payload } }
    case 'CLEAR_SEARCH':
      return { ...state, messages: { ...state.messages, searchQuery: '', searchResults: null } }

    // New mail push
    case 'NEW_MAIL': {
      if (action.payload.folder === state.folders.selected) {
        // Will trigger a refresh in the component
        return { ...state, messages: { ...state.messages, _newMailSignal: Date.now() } }
      }
      return state
    }

    case 'SYNC_COMPLETE': {
      if (action.payload.folder === state.folders.selected) {
        return { ...state, messages: { ...state.messages, _syncSignal: Date.now() } }
      }
      return state
    }

    // Compose
    case 'OPEN_COMPOSE':
      return {
        ...state,
        compose: { isOpen: true, mode: action.payload.mode || 'new', referencedMessage: action.payload.message || null }
      }
    case 'CLOSE_COMPOSE':
      return { ...state, compose: { isOpen: false, mode: null, referencedMessage: null } }

    // Settings
    case 'TOGGLE_SETTINGS':
      return { ...state, settings: { ...state.settings, panelOpen: !state.settings.panelOpen } }
    case 'CLOSE_SETTINGS':
      return { ...state, settings: { ...state.settings, panelOpen: false } }
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } }

    // Loading bar
    case 'SET_LOADING':
      return { ...state, loading: { active: true, label: action.payload || '' } }
    case 'CLEAR_LOADING':
      return { ...state, loading: { active: false, label: '' } }

    // Toast notifications
    case 'ADD_NOTIFICATION':
      return { ...state, notifications: [...state.notifications, { id: Date.now(), ...action.payload }] }
    case 'REMOVE_NOTIFICATION':
      return { ...state, notifications: state.notifications.filter(n => n.id !== action.payload) }

    // View switching
    case 'SET_VIEW':
      return { ...state, view: action.payload }

    // Global sync state
    case 'SYNC_OPERATION_START':
      return {
        ...state,
        sync: {
          operationsInProgress: state.sync.operationsInProgress + 1,
          lastActivity: Date.now()
        }
      }
    case 'SYNC_OPERATION_END':
      return {
        ...state,
        sync: {
          operationsInProgress: Math.max(0, state.sync.operationsInProgress - 1),
          lastActivity: Date.now()
        }
      }

    // Contacts
    case 'SET_CONTACTS':
      return { ...state, contacts: { ...state.contacts, list: action.payload, loading: false } }
    case 'SET_CONTACTS_LOADING':
      return { ...state, contacts: { ...state.contacts, loading: action.payload } }
    case 'SET_CONTACTS_SYNCING':
      return { ...state, contacts: { ...state.contacts, syncing: action.payload } }
    case 'SET_CONTACTS_SEARCH':
      return { ...state, contacts: { ...state.contacts, searchQuery: action.payload } }
    case 'SELECT_CONTACT':
      return { ...state, contacts: { ...state.contacts, selected: action.payload } }

    // Calendar
    case 'SET_CALENDAR_EVENTS':
      return { ...state, calendar: { ...state.calendar, events: action.payload, loading: false } }
    case 'SET_CALENDAR_LOADING':
      return { ...state, calendar: { ...state.calendar, loading: action.payload } }
    case 'SET_CALENDAR_SYNCING':
      return { ...state, calendar: { ...state.calendar, syncing: action.payload } }

    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Check for existing credentials on mount
  useEffect(() => {
    async function checkAuth() {
      const result = await window.api.auth.getCredentials()
      if (result.ok && result.creds) {
        dispatch({ type: 'SET_AUTHENTICATED', payload: result.creds.email })
      }
      const settingsRes = await window.api.settings.get()
      if (settingsRes.ok) dispatch({ type: 'UPDATE_SETTINGS', payload: settingsRes.settings })
    }
    checkAuth()

    // Listen for sync operation events
    const unsubSyncStart = window.api.on('sync:operation-start', () => {
      dispatch({ type: 'SYNC_OPERATION_START' })
    })

    const unsubSyncEnd = window.api.on('sync:operation-end', () => {
      dispatch({ type: 'SYNC_OPERATION_END' })
    })

    return () => {
      unsubSyncStart?.()
      unsubSyncEnd?.()
    }
  }, [])

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>
        {children}
      </DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

export const useAppState = () => useContext(StateCtx)
export const useAppDispatch = () => useContext(DispatchCtx)
