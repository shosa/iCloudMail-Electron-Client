/**
 * Generates a minimal tray-icon.png using pure Node.js (no external deps).
 * Run: node scripts/gen-icons.mjs
 *
 * For a proper icon.ico, use a tool like:
 *   https://convertio.co/png-ico/
 * or install `png-to-ico` and add it as a devDep.
 */
import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dir, '..', 'resources')
mkdirSync(outDir, { recursive: true })

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const r = size * 0.25

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, '#0071e3')
  grad.addColorStop(1, '#5e5ebc')
  ctx.fillStyle = grad

  // Rounded rect
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, r)
  ctx.fill()

  // Envelope
  const pad = size * 0.16
  const ex = pad, ey = size * 0.28, ew = size - pad * 2, eh = size * 0.44
  ctx.strokeStyle = 'white'
  ctx.lineWidth = size * 0.06
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.roundRect(ex, ey, ew, eh, size * 0.06)
  ctx.stroke()
  // V flap
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(size / 2, ey + eh * 0.5)
  ctx.lineTo(ex + ew, ey)
  ctx.stroke()

  return canvas.toBuffer('image/png')
}

try {
  const { createCanvas } = await import('canvas')
  const buf = drawIcon(32)
  writeFileSync(join(outDir, 'tray-icon.png'), buf)
  writeFileSync(join(outDir, 'icon.png'), drawIcon(256))
  console.log('Icons written to resources/')
} catch {
  console.log('canvas package not installed — use online converter for icons.')
  console.log('Place tray-icon.png (32×32) and icon.ico (256×256) in resources/')
}
