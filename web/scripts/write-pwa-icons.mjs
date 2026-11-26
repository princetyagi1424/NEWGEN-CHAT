#!/usr/bin/env node
/** Generate PWA icons at build time (no external deps). */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'public', 'icons'), { recursive: true })

function crcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}
const CRC = crcTable()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}
function pngRGBA(width, height, rgbaFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaFn(x, y, width, height)
      const i = row + 1 + x * 4
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function colorAt(x, y, size) {
  const t = y / Math.max(size - 1, 1)
  let r, g, b
  if (t < 0.35) {
    const u = t / 0.35
    r = (109 + (168 - 109) * u) | 0
    g = (40 + (85 - 40) * u) | 0
    b = (217 + (247 - 217) * u) | 0
  } else if (t < 0.7) {
    const u = (t - 0.35) / 0.35
    r = (168 + (236 - 168) * u) | 0
    g = (85 + (72 - 85) * u) | 0
    b = (247 + (153 - 247) * u) | 0
  } else {
    const u = (t - 0.7) / 0.3
    r = (236 + (251 - 236) * u) | 0
    g = (72 + (146 - 72) * u) | 0
    b = (153 + (60 - 153) * u) | 0
  }
  return [r, g, b, 255]
}

function makeIcon(size, maskable) {
  const pad = maskable ? size * 0.28 : size * 0.22
  const top = maskable ? size * 0.24 : size * 0.2
  const bot = maskable ? size * 0.6 : size * 0.58
  const rad = Math.floor(size / 4)
  return pngRGBA(size, size, (x, y, w, h) => {
    if (!maskable) {
      const m = Math.min(x, w - 1 - x)
      const n = Math.min(y, h - 1 - y)
      let inside = true
      if (m < rad && n < rad) inside = (m - rad) ** 2 + (n - rad) ** 2 <= rad * rad
      if (!inside) return [0, 0, 0, 0]
    } else {
      const cx = (w - 1) / 2, cy = (h - 1) / 2
      if ((x - cx) ** 2 + (y - cy) ** 2 > (w / 2) ** 2) return [0, 0, 0, 0]
    }
    let [r, g, b, a] = colorAt(x, y, size)
    if (x >= pad && x < size - pad && y >= top && y < bot) {
      const br = Math.max(8, size / 12)
      const bx = Math.min(x - pad, size - pad - 1 - x)
      const by = Math.min(y - top, bot - 1 - y)
      let inBubble = true
      if (bx < br && by < br) inBubble = (bx - br) ** 2 + (by - br) ** 2 <= br * br
      if (inBubble) {
        const dy = (top + bot) / 2
        const rr = Math.max(3, size / 28)
        for (const fx of [0.38, 0.5, 0.62]) {
          const dx = size * fx
          if ((x - dx) ** 2 + (y - dy) ** 2 <= rr * rr) return [109, 40, 217, 255]
        }
        return [255, 255, 255, 245]
      }
    }
    return [r, g, b, a]
  })
}

const files = [
  ['icons/icon-192.png', makeIcon(192, false)],
  ['icons/icon-512.png', makeIcon(512, false)],
  ['icons/icon-192-maskable.png', makeIcon(192, true)],
  ['icons/icon-512-maskable.png', makeIcon(512, true)],
  ['apple-touch-icon.png', makeIcon(180, false)],
]
for (const [rel, buf] of files) {
  const path = join(root, 'public', rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
  console.log('wrote', rel, buf.length)
}
