// Generates the app + tray icons procedurally (no image tooling needed).
// Usage: node scripts/gen-icons.mjs   → writes into build/
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

// Signed distance to a rounded rectangle (centre cx,cy, half-size hx,hy, radius r).
const sdRoundRect = (x, y, cx, cy, hx, hy, r) => {
  const qx = Math.abs(x - cx) - hx + r
  const qy = Math.abs(y - cy) - hy + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
// Dock glyph: an outlined tray with three tiles on its shelf. Returns coverage 0..1.
function glyph(x, y, px) {
  const outer = sdRoundRect(x, y, 0.5, 0.5, 0.4, 0.3, 0.1)
  const ring = Math.abs(outer) - 0.045
  const tiles = Math.min(
    ...[0.31, 0.5, 0.69].map((cx) => sdRoundRect(x, y, cx, 0.6, 0.065, 0.065, 0.02)),
  )
  const d = Math.min(ring, tiles)
  return Math.min(1, Math.max(0, 0.5 - d / px))
}
function render(size, { bg, fg, template }) {
  const out = Buffer.alloc(size * size * 4)
  const px = 1 / size
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size
      const y = (j + 0.5) / size
      const o = (j * size + i) * 4
      if (template) {
        out[o + 3] = Math.round(glyph(x, y, px) * 255)
        continue
      }
      const inBg = Math.min(1, Math.max(0, 0.5 - sdRoundRect(x, y, 0.5, 0.5, 0.45, 0.45, 0.1) / px))
      // Glyph drawn at 70% inside the tile.
      const g = glyph((x - 0.5) / 0.7 + 0.5, (y - 0.5) / 0.7 + 0.5, px / 0.7)
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(bg[c] * (1 - g) + fg[c] * g)
      out[o + 3] = Math.round(inBg * 255)
    }
  return out
}

const app = { bg: [0x0b, 0x5c, 0xad], fg: [0xff, 0xff, 0xff], template: false }
const tray = { template: true }
mkdirSync('build/tray', { recursive: true })
writeFileSync('build/icon.png', png(1024, render(1024, app)))
writeFileSync(
  'build/icon.ico',
  ico([16, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: png(s, render(s, app)) }))),
)
writeFileSync('build/tray/trayTemplate.png', png(16, render(16, tray)))
writeFileSync('build/tray/trayTemplate@2x.png', png(32, render(32, tray)))
// Windows tray: white glyph on the accent tile reads on both light and dark taskbars.
writeFileSync(
  'build/tray/tray.ico',
  ico([16, 24, 32].map((s) => ({ size: s, data: png(s, render(s, app)) }))),
)
console.log('icons written to build/')
