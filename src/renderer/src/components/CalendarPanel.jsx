import React, { useEffect, useCallback, useState } from 'react'
import { useAppState, useAppDispatch } from '../context/AppContext'
import { useTranslation } from '../i18n/index'
import { IconCalendar, IconClock, IconPin, IconClose } from './Icons'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function formatEventTime(ev) {
  if (ev.all_day) return null
  const start = new Date(ev.start_ts)
  const end   = new Date(ev.end_ts)
  const fmt = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatEventDate(ev) {
  const d = new Date(ev.start_ts)
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function groupEventsByDate(events) {
  const groups = {}
  for (const ev of events) {
    const d = new Date(ev.start_ts)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (!groups[key]) groups[key] = { label: formatEventDate(ev), events: [] }
    groups[key].events.push(ev)
  }
  return Object.entries(groups).sort(([a],[b]) => a.localeCompare(b))
}

function MiniCalendar({ selectedDate, onSelect }) {
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())

  const today = new Date()
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function prev() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function next() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const selD = selectedDate ? new Date(selectedDate) : null

  return (
    <div className="mini-calendar">
      <div className="mini-calendar__nav">
        <button className="btn btn--icon" onClick={prev} style={{ width: 24, height: 24 }}>‹</button>
        <span className="mini-calendar__month-label">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className="btn btn--icon" onClick={next} style={{ width: 24, height: 24 }}>›</button>
      </div>
      <div className="mini-calendar__grid">
        {DAY_NAMES.map(d => <div key={d} className="mini-calendar__day-name">{d[0]}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />
          const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()
          const isSel = selD && day === selD.getDate() && viewMonth === selD.getMonth() && viewYear === selD.getFullYear()
          return (
            <div
              key={day}
              className={`mini-calendar__day${isToday ? ' today' : ''}${isSel ? ' selected' : ''}`}
              onClick={() => onSelect(new Date(viewYear, viewMonth, day).getTime())}
            >{day}</div>
          )
        })}
      </div>
    </div>
  )
}

function EventCard({ event, onClick, selected }) {
  const time = formatEventTime(event)
  return (
    <div
      className={`event-card${selected ? ' active' : ''}`}
      onClick={() => onClick(event)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(event)}
    >
      <div className="event-card__dot" />
      <div className="event-card__body">
        <div className="event-card__title">{event.title}</div>
        {time && (
          <div className="event-card__time">
            <IconClock size={11} /> {time}
          </div>
        )}
        {!!event.all_day && (
          <div className="event-card__time">All day</div>
        )}
      </div>
    </div>
  )
}

function EventDetail({ event, onClose }) {
  const t = useTranslation()
  const time = formatEventTime(event)
  return (
    <div className="event-detail">
      <div className="event-detail__header">
        <button className="btn btn--icon" onClick={onClose} aria-label={t('action.close')}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="event-detail__title">{event.title}</div>
      <div className="event-detail__meta">
        <div className="event-detail__row">
          <IconCalendar size={13} />
          <span>{formatEventDate(event)}</span>
        </div>
        {time && (
          <div className="event-detail__row">
            <IconClock size={13} />
            <span>{time}</span>
          </div>
        )}
        {event.location && (
          <div className="event-detail__row">
            <IconPin size={13} />
            <span>{event.location}</span>
          </div>
        )}
      </div>
      {event.description && (
        <div className="event-detail__desc">{event.description}</div>
      )}
      {event.organizer && (
        <div className="event-detail__organizer">
          {t('calendar.organizer')}: {event.organizer}
        </div>
      )}
      {event.attendees?.length > 0 && (
        <div className="event-detail__attendees">
          <div className="event-detail__attendees-label">{t('calendar.attendees')}:</div>
          {event.attendees.map((a, i) => <div key={i} className="event-detail__attendee">{a}</div>)}
        </div>
      )}
    </div>
  )
}

export default function CalendarPanel() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const t = useTranslation()
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)

  const loadEvents = useCallback(async () => {
    const email = state.auth.email
    if (!email) return
    dispatch({ type: 'SET_CALENDAR_LOADING', payload: true })
    const now = Date.now()
    const res = await window.api.calendar.events(email, now - 30 * 86400000, now + 180 * 86400000)
    if (res.ok) dispatch({ type: 'SET_CALENDAR_EVENTS', payload: res.events })
    else dispatch({ type: 'SET_CALENDAR_LOADING', payload: false })
  }, [state.auth.email, dispatch])

  useEffect(() => {
    if (state.auth.isAuthenticated && state.calendar.events.length === 0) {
      loadEvents()
    }
  }, [state.auth.isAuthenticated, state.calendar.events.length, loadEvents])

  const now = Date.now()
  const upcoming = (state.calendar.events || [])
    .filter(ev => {
      if (selectedDate) {
        const d = new Date(selectedDate)
        const evD = new Date(ev.start_ts)
        return evD.getFullYear() === d.getFullYear()
          && evD.getMonth() === d.getMonth()
          && evD.getDate() === d.getDate()
      }
      return ev.end_ts >= now
    })
    .sort((a, b) => a.start_ts - b.start_ts)
    .slice(0, 100)

  const grouped = groupEventsByDate(upcoming)

  return (
    <div className="calendar-panel">
      <div className="calendar-panel__left">
        <MiniCalendar
          selectedDate={selectedDate}
          onSelect={ts => setSelectedDate(prev => prev === ts ? null : ts)}
        />

        <div className="calendar-panel__events">
          {state.calendar.loading && grouped.length === 0 ? (
            <div className="calendar-panel__empty"><div className="spinner" /></div>
          ) : grouped.length === 0 ? (
            <div className="calendar-panel__empty">
              <div style={{ opacity: 0.2, marginBottom: 'var(--sp-3)' }}><IconCalendar size={44} /></div>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                {selectedDate ? t('calendar.noEventsDay') : t('calendar.noEvents')}
              </span>
            </div>
          ) : (
            grouped.map(([key, group]) => (
              <div key={key} className="calendar-panel__group">
                <div className="calendar-panel__date-label">{group.label}</div>
                {group.events.map(ev => (
                  <EventCard
                    key={ev.id}
                    event={ev}
                    selected={selectedEvent?.id === ev.id}
                    onClick={setSelectedEvent}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="calendar-panel__detail">
        {selectedEvent ? (
          <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />
        ) : (
          <div className="calendar-panel__empty">
            <div style={{ opacity: 0.2, marginBottom: 'var(--sp-3)' }}><IconCalendar size={52} /></div>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              {t('calendar.selectEvent')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
