import React from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import {
  IconCompose, IconReply, IconReplyAll, IconForward,
  IconTrash, IconMarkRead, IconNoSymbol, IconSync
} from './Icons'

export default function Toolbar() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const msg = state.messages?.selected
  const view = state.view || 'mail'
  const isMail = view === 'mail'
  const mailDisabled = !isMail || !msg

  function handleNew() {
    window.api.window.openCompose({ mode: 'new' })
  }

  function handleReply() {
    if (!msg) return
    window.api.window.openCompose({ mode: 'reply', message: msg })
  }

  function handleReplyAll() {
    if (!msg) return
    window.api.window.openCompose({ mode: 'replyAll', message: msg })
  }

  function handleForward() {
    if (!msg) return
    window.api.window.openCompose({ mode: 'forward', message: msg })
  }

  function handleDelete() {
    if (!msg) return
    dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: msg.uid, folder: msg.folder } })
    window.api.imap.deleteMessage(msg.folder, msg.uid, false)
  }

  function handleMarkJunk() {
    if (!msg) return
    dispatch({ type: 'REMOVE_MESSAGE', payload: { uid: msg.uid, folder: msg.folder } })
    window.api.imap.markJunk(msg.folder, msg.uid, true)
  }

  function handleToggleRead() {
    if (!msg) return
    const isRead = msg.flags?.includes('\\Seen')
    const newFlags = isRead
      ? msg.flags.filter(f => f !== '\\Seen')
      : [...(msg.flags || []), '\\Seen']
    dispatch({ type: 'UPDATE_MESSAGE_FLAGS', payload: { uid: msg.uid, folder: msg.folder, flags: newFlags } })
    window.api.imap.markRead(msg.folder, msg.uid, !isRead)
  }

  async function handleSync() {
    const email = state.auth.email
    if (!email) return

    dispatch({ type: 'SYNC_OPERATION_START' })

    if (view === 'contacts') {
      dispatch({ type: 'SET_CONTACTS_SYNCING', payload: true })
      try {
        const credRes = await window.api.auth.getCredentials()
        if (!credRes.ok || !credRes.creds) return
        await window.api.contacts.sync(email, credRes.creds.password)
        const listRes = await window.api.contacts.list(email)
        if (listRes.ok) dispatch({ type: 'SET_CONTACTS', payload: listRes.contacts })
      } catch { /* ignore */ }
      dispatch({ type: 'SET_CONTACTS_SYNCING', payload: false })
    } else if (view === 'calendar') {
      dispatch({ type: 'SET_CALENDAR_SYNCING', payload: true })
      try {
        const credRes = await window.api.auth.getCredentials()
        if (!credRes.ok || !credRes.creds) return
        await window.api.calendar.sync(email, credRes.creds.password)
        const now = Date.now()
        const evRes = await window.api.calendar.events(email, now - 30 * 86400000, now + 180 * 86400000)
        if (evRes.ok) dispatch({ type: 'SET_CALENDAR_EVENTS', payload: evRes.events })
      } catch { /* ignore */ }
      dispatch({ type: 'SET_CALENDAR_SYNCING', payload: false })
    } else if (view === 'mail') {
      // Trigger manual inbox sync for mail view
      try {
        await window.api.imap.syncInbox()
      } catch { /* ignore */ }
    }

    dispatch({ type: 'SYNC_OPERATION_END' })
  }

  const isRead = msg?.flags?.includes('\\Seen')
  const isLocalSyncing = view === 'contacts' ? state.contacts?.syncing : state.calendar?.syncing
  const isGlobalSyncing = state.sync?.operationsInProgress > 0
  const isSyncing = isLocalSyncing || isGlobalSyncing

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button
          className="toolbar__btn toolbar__btn--primary toolbar__btn--circle"
          onClick={handleNew}
          title={t('toolbar.newMail')}
          aria-label={t('toolbar.newMail')}
        >
          <IconCompose size={16} />
        </button>
      </div>

      <div className="toolbar__separator" />

      <div className="toolbar__group">
        <button className="toolbar__btn" onClick={handleReply} disabled={mailDisabled} title={t('action.reply')}>
          <IconReply size={15} />
          <span>{t('action.reply')}</span>
        </button>
        <button className="toolbar__btn" onClick={handleReplyAll} disabled={mailDisabled} title={t('action.replyAll')}>
          <IconReplyAll size={15} />
          <span>{t('action.all')}</span>
        </button>
        <button className="toolbar__btn" onClick={handleForward} disabled={mailDisabled} title={t('action.forward')}>
          <IconForward size={15} />
          <span>{t('action.forward')}</span>
        </button>
      </div>

      <div className="toolbar__separator" />

      <div className="toolbar__group">
        <button
          className="toolbar__btn"
          onClick={handleToggleRead}
          disabled={mailDisabled}
          title={isRead ? t('action.markUnread') : t('action.markRead')}
        >
          <IconMarkRead size={15} />
          <span>{isRead ? t('action.markUnread') : t('action.markRead')}</span>
        </button>
        <button className="toolbar__btn" onClick={handleMarkJunk} disabled={mailDisabled} title={t('action.markJunk')}>
          <IconNoSymbol size={15} />
          <span>{t('action.markJunk')}</span>
        </button>
      </div>

      <div className="toolbar__separator" />

      <div className="toolbar__group">
        <button className="toolbar__btn toolbar__btn--danger" onClick={handleDelete} disabled={mailDisabled} title={t('action.delete')}>
          <IconTrash size={15} />
          <span>{t('action.delete')}</span>
        </button>
      </div>

      {!isMail && (
        <>
          <div style={{ flex: 1 }} />
          <div className="toolbar__group">
            <button
              className="toolbar__btn toolbar__btn--success toolbar__btn--circle"
              onClick={handleSync}
              disabled={isSyncing}
              title={isSyncing ? t('toolbar.syncing') : t('toolbar.sync')}
              aria-label={t('toolbar.sync')}
            >
              <IconSync size={15} className={isSyncing ? 'spin' : ''} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
