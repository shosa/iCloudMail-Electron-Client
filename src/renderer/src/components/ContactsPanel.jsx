import React, { useEffect, useState, useCallback } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import { IconSearch, IconContacts, IconMail, IconPhone, IconClose } from './Icons'

const AVATAR_COLORS = [
  '#0071e3','#5e5ebc','#bf5af2','#ff6b35',
  '#30d158','#ffd60a','#ff453a','#64d2ff'
]

function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function initials(name, email) {
  if (name) {
    const parts = name.trim().split(' ').filter(Boolean)
    if (parts.length >= 2) return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase()
    return [...parts[0]].slice(0, 2).join('').toUpperCase()
  }
  return [...(email || '?')].slice(0, 2).join('').toUpperCase()
}

function ContactRow({ contact, selected, onClick }) {
  const bg = avatarColor(contact.display_name || contact.email)
  const ini = initials(contact.display_name, contact.email)
  return (
    <div
      className={`contact-row${selected ? ' active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className="contact-row__avatar" style={{ background: bg }}>{ini}</div>
      <div className="contact-row__info">
        <div className="contact-row__name">{contact.display_name || contact.email}</div>
        {contact.email && contact.display_name && (
          <div className="contact-row__email">{contact.email}</div>
        )}
      </div>
    </div>
  )
}

function ContactDetail({ contact, onClose, onCompose }) {
  const t = useTranslation()
  const bg = avatarColor(contact.display_name || contact.email)
  const ini = initials(contact.display_name, contact.email)
  return (
    <div className="contact-detail">
      <div className="contact-detail__header">
        <button className="btn btn--icon" onClick={onClose} aria-label={t('action.close')}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="contact-detail__hero">
        <div className="contact-detail__avatar" style={{ background: bg }}>{ini}</div>
        <div className="contact-detail__name">{contact.display_name || contact.email}</div>
        {contact.title && <div className="contact-detail__title">{contact.title}</div>}
        {contact.organization && <div className="contact-detail__org">{contact.organization}</div>}
      </div>
      <div className="contact-detail__fields">
        {contact.emails?.map((em, i) => (
          <div key={i} className="contact-detail__field">
            <IconMail size={14} />
            <a href={`mailto:${em}`} onClick={e => { e.preventDefault(); onCompose(em) }}>{em}</a>
          </div>
        ))}
        {contact.phones?.map((ph, i) => (
          <div key={i} className="contact-detail__field">
            <IconPhone size={14} />
            <span>{ph}</span>
          </div>
        ))}
        {contact.notes && (
          <div className="contact-detail__notes">{contact.notes}</div>
        )}
      </div>
    </div>
  )
}

export default function ContactsPanel() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const [localSearch, setLocalSearch] = useState('')

  const loadContacts = useCallback(async () => {
    const email = state.auth.email
    if (!email) return
    dispatch({ type: 'SET_CONTACTS_LOADING', payload: true })
    const res = await window.api.contacts.list(email)
    if (res.ok) dispatch({ type: 'SET_CONTACTS', payload: res.contacts })
    else dispatch({ type: 'SET_CONTACTS_LOADING', payload: false })
  }, [state.auth.email, dispatch])

  useEffect(() => {
    if (state.auth.isAuthenticated && state.contacts.list.length === 0) {
      loadContacts()
    }
  }, [state.auth.isAuthenticated])

  const displayed = localSearch.trim()
    ? state.contacts.list.filter(c => {
        const q = localSearch.toLowerCase()
        return (c.display_name || '').toLowerCase().includes(q)
          || (c.email || '').toLowerCase().includes(q)
          || (c.organization || '').toLowerCase().includes(q)
      })
    : state.contacts.list

  const selected = state.contacts.selected

  function handleCompose(email) {
    window.api.window.openCompose({ mode: 'new', to: email })
  }

  return (
    <div className="contacts-panel">
      <div className="contacts-panel__list">
        <div className="contacts-panel__search-wrap">
          <IconSearch size={14} />
          <input
            className="contacts-panel__search"
            type="text"
            placeholder={t('contacts.search')}
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
          />
          {localSearch && (
            <button className="btn btn--icon" style={{ width: 24, height: 24 }} onClick={() => setLocalSearch('')}>
              <IconClose size={12} />
            </button>
          )}
        </div>
        <div className="contacts-panel__rows">
          {state.contacts.loading && displayed.length === 0 ? (
            <div className="contacts-panel__empty">
              <div className="spinner" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="contacts-panel__empty">
              <div style={{ opacity: 0.2, marginBottom: 'var(--sp-3)' }}><IconContacts size={44} /></div>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                {localSearch ? t('messages.noResults') : t('contacts.empty')}
              </span>
            </div>
          ) : (
            displayed.map(c => (
              <ContactRow
                key={c.id || c.email}
                contact={c}
                selected={selected?.id === c.id}
                onClick={() => dispatch({ type: 'SELECT_CONTACT', payload: c })}
              />
            ))
          )}
        </div>
      </div>

      <div className="contacts-panel__detail">
        {selected ? (
          <ContactDetail
            contact={selected}
            onClose={() => dispatch({ type: 'SELECT_CONTACT', payload: null })}
            onCompose={handleCompose}
          />
        ) : (
          <div className="contacts-panel__empty">
            <div style={{ opacity: 0.2, marginBottom: 'var(--sp-3)' }}><IconContacts size={52} /></div>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              {t('contacts.selectContact')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
