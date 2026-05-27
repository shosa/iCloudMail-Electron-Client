import { safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

function credsDir() {
  const dir = join(app.getPath('userData'), 'auth')
  mkdirSync(dir, { recursive: true })
  return dir
}

function credsFile(email) {
  const safe = email.replace(/[^a-z0-9@._-]/gi, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return join(credsDir(), `${safe}.bin`)
}

export async function saveCredentials(email, password) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available')
  const encrypted = safeStorage.encryptString(JSON.stringify({ email, password }))
  writeFileSync(credsFile(email), encrypted)
}

export async function getCredentials(email) {
  if (!safeStorage.isEncryptionAvailable()) return null
  if (email) {
    const filePath = credsFile(email)
    if (!existsSync(filePath)) return null
    try {
      const buf = readFileSync(filePath)
      return JSON.parse(safeStorage.decryptString(buf))
    } catch { return null }
  }
  const dir = credsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.bin')).sort()
  if (!files.length) return null
  try {
    const buf = readFileSync(join(dir, files[0]))
    return JSON.parse(safeStorage.decryptString(buf))
  } catch { return null }
}

export async function deleteCredentials(email) {
  if (email) {
    const filePath = credsFile(email)
    if (existsSync(filePath)) unlinkSync(filePath)
    return
  }
  const dir = credsDir()
  for (const f of readdirSync(dir).filter(f => f.endsWith('.bin'))) {
    try { unlinkSync(join(dir, f)) } catch { /* skip locked file */ }
  }
}

export async function listStoredEmails() {
  if (!safeStorage.isEncryptionAvailable()) return []
  const dir = credsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.bin'))
  const emails = []
  for (const file of files) {
    try {
      const buf = readFileSync(join(dir, file))
      const { email } = JSON.parse(safeStorage.decryptString(buf))
      emails.push(email)
    } catch { /* skip corrupt file */ }
  }
  return emails
}
