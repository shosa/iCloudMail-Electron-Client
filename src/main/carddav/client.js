import { request } from 'https'
import { URL } from 'url'
import { logContact, logWarn, logErr } from '../logger.js'

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
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')) })
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

// ── XML entity decoder ────────────────────────────────────────────────────────

function decodeXmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// ── vCard parser ──────────────────────────────────────────────────────────────

function unfoldVCard(raw) {
  return raw.replace(/\r?\n[ \t]/g, '')
}

export function parseVCard(raw) {
  // Decode any XML entities (&#13; → \r, &apos; → ', etc.) then strip bare \r
  const cleaned = decodeXmlEntities(raw).replace(/\r/g, '')
  const lines = unfoldVCard(cleaned).split('\n')
  const result = { emails: [], phones: [] }

  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const prop = line.slice(0, colonIdx).toUpperCase()
    const val  = line.slice(colonIdx + 1).trim()

    if (prop === 'UID')    result.uid = val
    else if (prop === 'FN')   result.display_name = val
    else if (prop === 'N') {
      const parts = val.split(';')
      result.last_name  = (parts[0] || '').trim()
      result.first_name = (parts[1] || '').trim()
    }
    else if (prop.startsWith('EMAIL')) result.emails.push(val)
    else if (prop.startsWith('TEL'))   result.phones.push(val)
    else if (prop.startsWith('ORG'))   result.organization = val.split(';')[0].trim()
    else if (prop === 'TITLE')         result.title = val
    else if (prop === 'NOTE')          result.notes = val.replace(/\\n/g, '\n')
  }

  result.email = result.emails[0] || ''
  result.phone = result.phones[0] || ''
  if (!result.display_name) {
    result.display_name = [result.first_name, result.last_name].filter(Boolean).join(' ') || result.email || ''
  }
  return result
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

async function discoverAddressBook(email, password) {
  const auth = { user: email, pass: password }

  // Step 1: PROPFIND on well-known URL
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop><current-user-principal/></prop>
</propfind>`

  let res = await followRedirects(
    'https://contacts.icloud.com/.well-known/carddav',
    'PROPFIND', auth, propfindBody, { 'Depth': '0' }
  )

  // Step 2: Extract principal URL from response
  let principalUrl = extractXmlProp(res.body, 'current-user-principal')
  if (principalUrl) {
    // The element contains <href>...</href> — extract the path from within it
    const nested = extractXmlProp(principalUrl, 'href')
    if (nested) principalUrl = nested.trim()
  }
  if (!principalUrl) {
    const hrefs = extractAllMatches(res.body, 'href')
    principalUrl = hrefs.find(h => h.includes('/carddavhome') || h.includes('/principal')) || null
  }

  if (!principalUrl) {
    // Use the final redirect URL — for iCloud this is the user's CarDAV home
    principalUrl = res.finalUrl
  }

  const principalFull = principalUrl.startsWith('http')
    ? principalUrl
    : new URL(principalUrl, res.finalUrl).href
  logContact(`Principal URL: ${principalFull}`)

  // Step 3: PROPFIND on principal to find address book home
  res = await followRedirects(principalFull, 'PROPFIND', auth, `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <prop><card:addressbook-home-set/></prop>
</propfind>`, { 'Depth': '0' })

  let abHome = extractXmlProp(res.body, 'addressbook-home-set')
  if (abHome) {
    const hrefMatch = abHome.match(/<(?:[^:>]+:)?href[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?href>/i)
    if (hrefMatch) abHome = hrefMatch[1].trim()
  }

  if (!abHome) {
    abHome = principalFull
  }

  const abHomeFull = abHome.startsWith('http')
    ? abHome
    : new URL(abHome, principalFull).href
  logContact(`Address book home: ${abHomeFull}`)

  // Step 4: PROPFIND on address book home to find address books
  res = await followRedirects(abHomeFull, 'PROPFIND', auth, `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <prop>
    <resourcetype/>
    <displayname/>
  </prop>
</propfind>`)

  // Extract address book collections
  const responses = extractAllMatches(res.body, 'response')
  const addressBooks = []
  for (const r of responses) {
    if (r.includes('addressbook') || r.includes('ADDRESSBOOK')) {
      const href = extractXmlProp(r, 'href')
      const name = extractXmlProp(r, 'displayname') || 'Contacts'
      if (href) {
        const full = href.startsWith('http') ? href : new URL(href, abHomeFull).href
        addressBooks.push({ href: full, name })
      }
    }
  }

  if (addressBooks.length === 0) {
    addressBooks.push({ href: abHomeFull, name: 'Contacts' })
  }

  return addressBooks
}

// ── Sync ──────────────────────────────────────────────────────────────────────

function _parseVCardResponses(xmlBody, baseUrl) {
  const responses = extractAllMatches(xmlBody, 'response')
  const contacts = []
  for (const r of responses) {
    const href  = extractXmlProp(r, 'href') || ''
    const etag  = extractXmlProp(r, 'getetag') || ''
    const vcard = extractXmlProp(r, 'address-data') || ''
    if (!vcard) continue
    const parsed = parseVCard(vcard)
    if (!parsed.uid && !parsed.email) continue
    const fullHref = href.startsWith('http') ? href : new URL(href, baseUrl).href
    contacts.push({
      id: parsed.uid || href,
      href: fullHref,
      etag: etag.replace(/"/g, ''),
      vcard,
      ...parsed
    })
  }
  return contacts
}

async function fetchVCards(abUrl, auth) {
  logContact(`Scarico contatti da "${abUrl}"`)
  // Strategy 1: addressbook-query REPORT (standard)
  const queryBody = `<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN"/>
  </C:filter>
</C:addressbook-query>`

  let res = await followRedirects(abUrl, 'REPORT', auth, queryBody, {
    'Depth': '1',
    'Content-Type': 'application/xml; charset=utf-8'
  })

  if (res.status < 400) {
    const contacts = _parseVCardResponses(res.body, abUrl)
    logContact(`Strategia 1 (addressbook-query): trovati ${contacts.length} contatti`)
    return contacts
  }

  logContact(`Strategia 1 fallita (${res.status}), provo PROPFIND…`)
  // Strategy 2: PROPFIND Depth:1 to collect .vcf hrefs, then multiget
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`

  res = await followRedirects(abUrl, 'PROPFIND', auth, propfindBody, { 'Depth': '1' })
  if (res.status >= 400) throw new Error(`CardDAV PROPFIND failed: ${res.status}`)

  const propResponses = extractAllMatches(res.body, 'response')
  const vcfHrefs = []
  for (const r of propResponses) {
    const href = (extractXmlProp(r, 'href') || '').trim()
    if (!href) continue
    const isCollection = r.includes('collection')
    if (!isCollection && (href.endsWith('.vcf') || href.includes('/card'))) {
      vcfHrefs.push(href)
    }
  }

  if (vcfHrefs.length === 0) {
    // No .vcf entries found — try treating every non-collection href as a contact
    for (const r of propResponses) {
      const href = (extractXmlProp(r, 'href') || '').trim()
      if (!href) continue
      const isCollection = r.includes('collection')
      const isAbHome = href === new URL(abUrl).pathname || href === abUrl
      if (!isCollection && !isAbHome) vcfHrefs.push(href)
    }
  }

  if (vcfHrefs.length === 0) {
    logContact('Nessun .vcf trovato con PROPFIND')
    return []
  }

  logContact(`Strategia 2: trovati ${vcfHrefs.length} href .vcf, avvio multiget…`)
  // addressbook-multiget with the collected hrefs
  const hrefXml = vcfHrefs.map(h => `    <D:href>${h}</D:href>`).join('\n')
  const multigetBody = `<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
${hrefXml}
</C:addressbook-multiget>`

  res = await followRedirects(abUrl, 'REPORT', auth, multigetBody, {
    'Depth': '1',
    'Content-Type': 'application/xml; charset=utf-8'
  })

  if (res.status >= 400) throw new Error(`CardDAV multiget failed: ${res.status}`)
  const contacts = _parseVCardResponses(res.body, abUrl)
  logContact(`Strategia 3 (multiget): trovati ${contacts.length} contatti`)
  return contacts
}

export async function syncContacts(email, password) {
  logContact(`Inizio sync contatti per ${email}`)
  const auth = { user: email, pass: password }
  const addressBooks = await discoverAddressBook(email, password)
  logContact(`Trovate ${addressBooks.length} rubrica/e: ${addressBooks.map(a => a.name).join(', ')}`)
  const allContacts = []

  for (const ab of addressBooks) {
    try {
      const contacts = await fetchVCards(ab.href, auth)
      allContacts.push(...contacts)
    } catch (err) {
      logWarn(`CardDAV: errore rubrica "${ab.name}": ${err.message}`)
    }
  }

  logContact(`Sync contatti completato: ${allContacts.length} contatti totali`)
  return allContacts
}
