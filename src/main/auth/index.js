import { safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

function credPath() {
  const dir = join(app.getPath('userData'), 'auth')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'creds.bin')
}

export function saveCredentials(email, password) {
  const plaintext = JSON.stringify({ email, password })
  const encrypted = safeStorage.encryptString(plaintext)
  writeFileSync(credPath(), encrypted)
}

export function getCredentials() {
  const file = credPath()
  if (!existsSync(file)) return null
  try {
    const encrypted = readFileSync(file)
    const plaintext = safeStorage.decryptString(encrypted)
    return JSON.parse(plaintext)
  } catch {
    return null
  }
}

export function deleteCredentials() {
  const file = credPath()
  if (existsSync(file)) rmSync(file)
}
