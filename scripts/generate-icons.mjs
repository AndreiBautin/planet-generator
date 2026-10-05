/**
 * Draws the app icons and writes them to public/icons as PNGs.
 *
 *   node scripts/generate-icons.mjs
 *
 * A lit planet — ocean, continents, a polar cap and a rim of air — on the
 * app's night-sky background. Drawn here, pixel by pixel, rather than kept as
 * binary art nobody can regenerate: change a colour below and run this again.
 * No dependencies: PNG is a zlib stream with a few checksummed chunks, and
 * Node has zlib.
 *
 * The maskable icon keeps the planet inside the central 80% safe zone, since
 * Android crops maskable icons to a circle, a squircle or whatever its
 * launcher likes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const SPACE = [5, 6, 10]
const DEEP = [11, 29, 63]
const SHALLOW = [31, 111, 143]
const LAND = [47, 107, 42]
const DRY = [143, 154, 74]
const ICE = [242, 246, 250]
const AIR = [90, 160, 255]

// A small seeded value noise, so the continents are the same on every run.
const lattice = new Float64Array(64 * 64 * 64)
let state = 0x2f6b2a
for (let at = 0; at < lattice.length; at += 1) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  lattice[at] = state / 4294967296
}
const smooth = (t) => t * t * (3 - 2 * t)
const cell = (x, y, z) => lattice[((x & 63) * 64 + (y & 63)) * 64 + (z & 63)]
function noise(x, y, z) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  const w = smooth(z - zi)
  const lerp = (a, b, t) => a + (b - a) * t
  const at = (dx, dy, dz) => cell(xi + dx, yi + dy, zi + dz)
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  )
}
function fbm(x, y, z) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let octave = 0; octave < 5; octave += 1) {
    sum += noise(x * freq + 11, y * freq + 23, z * freq + 37) * amp
    amp *= 0.5
    freq *= 2
  }
  return sum
}

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * Math.min(1, Math.max(0, t)))

/** Colour of the icon at (px, py), with the planet of radius `r` centred. */
function shade(px, py, size, r) {
  const cx = size / 2
  const cy = size / 2
  const dx = (px - cx) / r
  const dy = (py - cy) / r
  const d2 = dx * dx + dy * dy
  // The rim of air: a glow just outside the limb, brightest on the lit side.
  if (d2 > 1) {
    const d = Math.sqrt(d2)
    const glow = Math.max(0, 1 - (d - 1) / 0.12) ** 2 * Math.max(0.15, (-dx - dy * 0.4) * 0.8 + 0.4)
    return mix(SPACE, AIR, glow * 0.9)
  }
  const nz = Math.sqrt(1 - d2)
  // Turn the sphere a little so the continents are not centred dead on.
  const x = dx * 0.9 + nz * 0.44
  const y = dy
  const z = nz * 0.9 - dx * 0.44
  const height = fbm(x * 1.6 + 3, y * 1.6, z * 1.6) - 0.5
  let colour
  // Caps ragged by the same noise, so they are not ruler-straight bands.
  if (Math.abs(y) + height * 0.5 > 0.86) colour = ICE
  else if (height > 0.06) colour = mix(LAND, DRY, (height - 0.06) * 6)
  else colour = mix(DEEP, SHALLOW, (height + 0.12) / 0.18)
  // Sun from the upper left; a soft terminator on the lower right.
  const light = Math.max(0, -dx * 0.55 - dy * 0.45 + nz * 0.7)
  const lit = 0.12 + 0.95 * light
  const edge = mix(
    colour.map((c) => c * lit),
    AIR,
    (1 - nz) ** 3 * 0.5,
  )
  return edge
}

function render(size, planetShare) {
  const r = (size * planetShare) / 2
  const rows = []
  const samples = 3
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(1 + size * 3)
    for (let px = 0; px < size; px += 1) {
      let acc = [0, 0, 0]
      // Supersampled, so the limb is smooth at 192 pixels.
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const c = shade(px + (sx + 0.5) / samples, py + (sy + 0.5) / samples, size, r)
          acc = acc.map((value, i) => value + c[i])
        }
      }
      const n = samples * samples
      row[1 + px * 3] = Math.round(Math.min(255, acc[0] / n))
      row[2 + px * 3] = Math.round(Math.min(255, acc[1] / n))
      row[3 + px * 3] = Math.round(Math.min(255, acc[2] / n))
    }
    rows.push(row)
  }
  return png(size, Buffer.concat(rows))
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
function png(size, raw) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour, no alpha: the background is part of the icon
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(out, { recursive: true })
const icons = [
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  // Inside the 80% safe zone, with room for the glow.
  ['maskable-512.png', 512, 0.6],
  ['apple-touch-icon.png', 180, 0.74],
  ['favicon-32.png', 32, 0.86],
]
for (const [name, size, share] of icons) {
  writeFileSync(join(out, name), render(size, share))
  console.log(`wrote public/icons/${name}`)
}
