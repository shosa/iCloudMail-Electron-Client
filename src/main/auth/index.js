import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function credsDir() {
  const dir = join(app.getPath('userData'), 'auth')
  mkdirSync(dir, { recursive: true })
  return dir
}

function credsFile(email) {
  return join(credsDir(), `${email.replace(/[^a-z0-9@._-]/gi, '_')}.bin`)
}

export async function saveCredentials(email, password) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available')
  const encrypted = safeStorage.encryptString(JSON.stringify({ email, password }))
  writeFileSync(credsFile(email), encrypted)
}

export async function getCredentials(email) {
  if (email) {
    const path = credsFile(email)
    if (!existsSync(path)) return null
    try {
      const buf = readFileSync(path)
      return JSON.parse(safeStorage.decryptString(buf))
    } catch { return null }
  }
  const dir = credsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.bin'))
  if (!files.length) return null
  try {
    const buf = readFileSync(join(dir, files[0]))
    return JSON.parse(safeStorage.decryptString(buf))
  } catch { return null }
}

export async function deleteCredentials(email) {
  if (email) {
    const path = credsFile(email)
    if (existsSync(path)) unlinkSync(path)
    return
  }
  const dir = credsDir()
  readdirSync(dir).filter(f => f.endsWith('.bin')).forEach(f => unlinkSync(join(dir, f)))
}

export async function listStoredEmails() {
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
