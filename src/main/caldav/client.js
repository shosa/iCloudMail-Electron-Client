import { request } from 'https'
import { URL } from 'url'
import { logCal, logWarn } from '../logger.js'

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function davRequest(url, method, auth, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64'),
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
        ...headers
      }
    }
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body)

    const req = request(opts, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')) })
    if (body) req.write(body)
    req.end()
  })
}

async function followRedirects(url, method, auth, body, headers, maxRedirects = 5) {
  let current = url
  for (let i = 0; i < maxRedirects; i++) {
    const res = await davRequest(current, method, auth, body, headers)
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const loc = res.headers.location
      current = loc.startsWith('http') ? loc : new URL(loc, current).href
    } else {
      return { ...res, finalUrl: current }
    }
  }
  throw new Error('Too many redirects')
}

// ── iCal parser ───────────────────────────────────────────────────────────────

function unfold(raw) {
  return raw.replace(/\r?\n[ \t]/g, '')
}

function parseICalDate(val, tzid) {
  if (!val) return null
  // Formats: 19970714T173000Z, 19970714, 19970714T173000
  const allDay = /^\d{8}$/.test(val)
  if (allDay) {
    const y = parseInt(val.slice(0, 4))
    const m = parseInt(val.slice(4, 6)) - 1
    const d = parseInt(val.slice(6, 8))
    return { ts: new Date(Date.UTC(y, m, d)).getTime(), allDay: true }
  }
  // Extract date/time parts
  const m = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (m) {
    const utc = m[7] === 'Z'
    if (!utc && tzid) {
      console.warn('[CAL] TZID not supported, treating as local time:', tzid)
    }
    const d = new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    )
    const ts = utc ? Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6])) : d.getTime()
    return { ts, allDay: false }
  }
  return null
}

export function parseICalEvents(icsData) {
  const unfolded = unfold(icsData)
  const events = []

  const eventBlocks = unfolded.split(/BEGIN:VEVENT/i).slice(1)
  for (const block of eventBlocks) {
    const lines = block.split(/\r?\n/)
    const event = {}

    for (const line of lines) {
      if (line.toUpperCase().startsWith('END:VEVENT')) break
      const colonIdx = line.indexOf(':')
      if (colonIdx < 0) continue
      const rawProp = line.slice(0, colonIdx)
      const val = line.slice(colonIdx + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';')
      const prop = rawProp.split(';')[0].toUpperCase()

      switch (prop) {
        case 'UID':         event.uid = val; break
        case 'SUMMARY':     event.title = val; break
        case 'DESCRIPTION': event.description = val; break
        case 'LOCATION':    event.location = val; break
        case 'STATUS':      event.status = val.toUpperCase(); break
        case 'RRULE':       event.rrule = val; break
        case 'ORGANIZER':   event.organizer = val.replace(/^MAILTO:/i, ''); break
        case 'DTSTART': {
          const tzidMatch = rawProp.match(/TZID=([^;:]+)/i)
          const parsed = parseICalDate(val.split(';').pop(), tzidMatch?.[1] || null)
          if (parsed) { event.start_ts = parsed.ts; event.all_day = parsed.allDay }
          break
        }
        case 'DTEND': {
          const tzidMatch = rawProp.match(/TZID=([^;:]+)/i)
          const parsed = parseICalDate(val.split(';').pop(), tzidMatch?.[1] || null)
          if (parsed) event.end_ts = parsed.ts
          break
        }
        case 'ATTENDEE': {
          if (!event.attendees) event.attendees = []
          event.attendees.push(val.replace(/^MAILTO:/i, ''))
          break
        }
      }
    }

    if (event.uid && event.title) {
      events.push({
        id: event.uid,
        title: event.title || '',
        description: event.description || null,
        location: event.location || null,
        start_ts: event.start_ts || 0,
        end_ts: event.end_ts || event.start_ts || 0,
        all_day: event.all_day || false,
        rrule: event.rrule || null,
        status: event.status || 'CONFIRMED',
        organizer: event.organizer || null,
        attendees: event.attendees || []
      })
    }
  }

  return events
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractXmlProp(xml, tag) {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i')
  const m = xml.match(re)
  return m ? m[1].trim() : null
}

function extractAllMatches(xml, tag) {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'gi')
  const matches = []
  let m
  while ((m = re.exec(xml)) !== null) matches.push(m[1])
  return matches
}

// ── Discovery ─────────────────────────────────────────────────────────────────

async function discoverCalendars(email, password) {
  const auth = { user: email, pass: password }

  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop><current-user-principal/></prop>
</propfind>`

  let res = await followRedirects(
    'https://caldav.icloud.com/.well-known/caldav',
    'PROPFIND', auth, propfindBody, { 'Depth': '0' }
  )

  let principalUrl = extractXmlProp(res.body, 'current-user-principal')
  if (principalUrl) {
    // The element contains <href>...</href> — extract the path from within it
    const nested = extractXmlProp(principalUrl, 'href')
    if (nested) principalUrl = nested.trim()
  }
  if (!principalUrl) {
    const hrefs = extractAllMatches(res.body, 'href')
    principalUrl = hrefs.find(h => h.includes('/principal') || h.length > 5) || null
  }
  if (!principalUrl) principalUrl = new URL(res.finalUrl).origin + '/'

  const principalFull = principalUrl.startsWith('http')
    ? principalUrl
    : new URL(principalUrl, res.finalUrl).href
  logCal(`Principal URL: ${principalFull}`)

  // Get calendar home
  res = await followRedirects(principalFull, 'PROPFIND', auth, `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <prop><cal:calendar-home-set/></prop>
</propfind>`, { 'Depth': '0' })

  let calHome = extractXmlProp(res.body, 'calendar-home-set')
  if (calHome) {
    const hrefMatch = calHome.match(/<(?:[^:>]+:)?href[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?href>/i)
    if (hrefMatch) calHome = hrefMatch[1].trim()
  }
  if (!calHome) calHome = principalFull

  const calHomeFull = calHome.startsWith('http')
    ? calHome
    : new URL(calHome, principalFull).href
  logCal(`Calendar home: ${calHomeFull}`)

  // List calendars
  res = await followRedirects(calHomeFull, 'PROPFIND', auth, `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <prop>
    <resourcetype/>
    <displayname/>
    <supported-calendar-component-set/>
  </prop>
</propfind>`)

  const responses = extractAllMatches(res.body, 'response')
  const calendars = []
  for (const r of responses) {
    if (r.includes('calendar') || r.includes('CALENDAR')) {
      const href = extractXmlProp(r, 'href')
      const name = extractXmlProp(r, 'displayname') || 'Calendar'
      if (href && !href.endsWith('calendars/')) {
        const full = href.startsWith('http') ? href : new URL(href, calHomeFull).href
        calendars.push({ href: full, name })
      }
    }
  }

  if (calendars.length === 0) calendars.push({ href: calHomeFull, name: 'Calendar' })

  return calendars
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function fetchCalendarEvents(calUrl, auth) {
  logCal(`Scarico eventi da "${calUrl}"`)
  // Time range: past 30 days to future 180 days
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 86400000)
  const end = new Date(now.getTime() + 180 * 86400000)

  function iCalDate(d) {
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<cal:calendar-query xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <cal:calendar-data/>
  </d:prop>
  <cal:filter>
    <cal:comp-filter name="VCALENDAR">
      <cal:comp-filter name="VEVENT">
        <cal:time-range start="${iCalDate(start)}" end="${iCalDate(end)}"/>
      </cal:comp-filter>
    </cal:comp-filter>
  </cal:filter>
</cal:calendar-query>`

  const res = await followRedirects(calUrl, 'REPORT', auth, body, {
    'Depth': '1',
    'Content-Type': 'application/xml; charset=utf-8'
  })

  if (res.status >= 400) {
    logCal(`REPORT fallito (${res.status}), provo PROPFIND…`)
    const fallback = await followRedirects(calUrl, 'PROPFIND', auth, `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <prop><getetag/><cal:calendar-data/></prop>
</propfind>`)
    if (fallback.status >= 400) {
      logCal(`PROPFIND fallito (${fallback.status}), nessun evento`)
      return []
    }
    const events = _parseEventResponses(fallback.body)
    logCal(`PROPFIND: trovati ${events.length} eventi`)
    return events
  }

  const events = _parseEventResponses(res.body)
  logCal(`REPORT: trovati ${events.length} eventi`)
  return events
}

function _parseEventResponses(xmlBody) {
  const responses = extractAllMatches(xmlBody, 'response')
  const events = []

  for (const r of responses) {
    const href = extractXmlProp(r, 'href') || ''
    const etag = (extractXmlProp(r, 'getetag') || '').replace(/"/g, '')
    const icsData = extractXmlProp(r, 'calendar-data') || ''
    if (!icsData) continue

    const parsed = parseICalEvents(icsData)
    for (const ev of parsed) {
      events.push({ ...ev, href, etag })
    }
  }

  return events
}

export async function syncCalendar(email, password) {
  logCal(`Inizio sync calendario per ${email}`)
  const auth = { user: email, pass: password }
  const calendars = await discoverCalendars(email, password)
  logCal(`Trovati ${calendars.length} calendario/i: ${calendars.map(c => c.name).join(', ')}`)
  const allEvents = []

  for (const cal of calendars) {
    try {
      const events = await fetchCalendarEvents(cal.href, auth)
      for (const ev of events) {
        allEvents.push({ ...ev, calendar_id: cal.name })
      }
    } catch (err) {
      logWarn(`CalDAV: errore calendario "${cal.name}": ${err.message}`)
    }
  }

  logCal(`Sync calendario completato: ${allEvents.length} eventi totali`)
  return allEvents
}
