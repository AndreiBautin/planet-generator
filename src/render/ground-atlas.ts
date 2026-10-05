/**
 * The ground's textures, baked rather than shipped: six tileable squares of
 * surface — grass, forest litter, sand, stone, snow, basalt — each a colour
 * with a height in its alpha, made from periodic noise so every edge meets
 * its opposite exactly and the square repeats across the ground without a
 * seam. The ground shader lays them on triplanar and blends by what the
 * ground is.
 *
 * Baked because a planet is procedural all the way down and a photograph
 * of Earth's sand on it would be a lie about which planet this is — and
 * because six photographs are megabytes a phone would precache. Pure, and
 * tested in Node: the output is bytes.
 *
 * Colours are kept near mid-grey on purpose: the shader multiplies the
 * biome's own colour by twice the texel, so a texture adds grain and
 * shadow to the ground's colour rather than replacing it.
 */
export const TILE = 256
export const GROUND_KINDS = ['grass', 'litter', 'sand', 'stone', 'snow', 'basalt'] as const
export type GroundKind = (typeof GROUND_KINDS)[number]

export interface GroundTile {
  readonly kind: GroundKind
  /** RGBA, TILE × TILE, row-major from the top. Alpha is height. */
  readonly data: Uint8Array
}

/** A hash of a lattice point, wrapped to the periods so the noise tiles. */
function latticeHash(ix: number, iy: number, px: number, py: number, salt: number): number {
  const x = ((ix % px) + px) % px
  const y = ((iy % py) + py) % py
  let h =
    Math.imul(x + 1, 0x27d4eb2f) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const fade = (t: number): number => t * t * (3 - 2 * t)

/** Value noise in [0, 1] that repeats every `px` cells across and `py` down; x and y in cells. */
function pnoise(x: number, y: number, px: number, py: number, salt: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const a = latticeHash(ix, iy, px, py, salt)
  const b = latticeHash(ix + 1, iy, px, py, salt)
  const c = latticeHash(ix, iy + 1, px, py, salt)
  const d = latticeHash(ix + 1, iy + 1, px, py, salt)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Periodic fbm in [0, 1]: u and v in [0, 1), `period` cells across at the first octave. */
function pfbm(u: number, v: number, period: number, octaves: number, salt: number): number {
  let sum = 0
  let weight = 0
  let amplitude = 1
  let cells = period
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += pnoise(u * cells, v * cells, cells, cells, salt + octave * 17) * amplitude
    weight += amplitude
    amplitude *= 0.5
    cells *= 2
  }
  return sum / weight
}

/** Periodic cells: distance to the nearest and second-nearest point, and the nearest's id. */
function pcells(u: number, v: number, period: number, salt: number): [number, number, number] {
  const x = u * period
  const y = v * period
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let f1 = 9
  let f2 = 9
  let id = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = ix + dx
      const cy = iy + dy
      const px = cx + latticeHash(cx, cy, period, period, salt)
      const py = cy + latticeHash(cx, cy, period, period, salt + 7)
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d < f1) {
        f2 = f1
        f1 = d
        id = latticeHash(cx, cy, period, period, salt + 13)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return [Math.sqrt(f1), Math.sqrt(f2), id]
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

type Texel = readonly [number, number, number, number]

/** One kind's texel at (u, v): linear rgb around 0.5, and a height 0 to 1. */
function texelOf(kind: GroundKind, u: number, v: number): Texel {
  switch (kind) {
    case 'grass': {
      // Blades: noise stretched tall, over clumps of lighter and darker turf.
      const clump = pfbm(u, v, 6, 4, 1)
      const blades =
        pnoise(u * 96, v * 24, 96, 24, 2) * 0.6 + pnoise(u * 192, v * 48, 192, 48, 3) * 0.4
      const tone = 0.42 + clump * 0.18 + blades * 0.16
      return [tone * 0.92, tone * 1.05, tone * 0.8, clamp01(0.3 + blades * 0.5 + clump * 0.2)]
    }
    case 'litter': {
      // Leaves and twigs: small cells, each its own brown, over damp earth.
      const [f1, , id] = pcells(u, v, 14, 4)
      const leaf = 1 - clamp01(f1 * 1.6)
      const earth = pfbm(u, v, 5, 5, 5)
      const tone = 0.36 + earth * 0.16 + leaf * (0.1 + id * 0.18)
      return [tone * 1.1, tone * 0.92, tone * 0.72, clamp01(0.35 + leaf * 0.45 + earth * 0.2)]
    }
    case 'sand': {
      // Fine grain under soft ripples the wind has drawn.
      const grain = pfbm(u, v, 48, 3, 6)
      const bend = pfbm(u, v, 3, 2, 7)
      const ripple = Math.sin((v * 7 + bend * 0.6) * Math.PI * 2) * 0.5 + 0.5
      const tone = 0.5 + (grain - 0.5) * 0.14 + (ripple - 0.5) * 0.1
      return [tone * 1.04, tone, tone * 0.92, clamp01(0.4 + ripple * 0.4 + (grain - 0.5) * 0.3)]
    }
    case 'stone': {
      // Blocks split by cracks, each block its own grey, with strata and grain.
      const [f1, f2, id] = pcells(u, v, 5, 8)
      const crack = 1 - clamp01((f2 - f1) * 6)
      const strata = pnoise(u * 3, v * 40, 3, 40, 9)
      const grain = pfbm(u, v, 24, 3, 10)
      const tone = (0.4 + id * 0.2 + strata * 0.08 + (grain - 0.5) * 0.12) * (1 - crack * 0.55)
      return [tone, tone * 0.98, tone * 0.95, clamp01(0.6 - crack * 0.6 + (grain - 0.5) * 0.2)]
    }
    case 'snow': {
      // Soft lumps, a fine sparkle here and there.
      const lumps = pfbm(u, v, 5, 4, 11)
      const sparkle =
        latticeHash(Math.floor(u * TILE), Math.floor(v * TILE), TILE, TILE, 12) > 0.985 ? 1 : 0
      const tone = 0.56 + (lumps - 0.5) * 0.1 + sparkle * 0.3
      return [tone * 0.98, tone, tone * 1.04, clamp01(0.45 + (lumps - 0.5) * 0.6)]
    }
    case 'basalt': {
      // Cooled lava: a pavement of dark polygons, pitted.
      const [f1, f2, id] = pcells(u, v, 8, 14)
      const joint = 1 - clamp01((f2 - f1) * 7)
      const pits = pfbm(u, v, 40, 3, 15)
      const tone = (0.44 + id * 0.1 + (pits - 0.5) * 0.14) * (1 - joint * 0.6)
      return [tone, tone * 0.97, tone * 0.95, clamp01(0.6 - joint * 0.5 + (pits - 0.5) * 0.3)]
    }
  }
}

export function bakeGroundTile(kind: GroundKind): GroundTile {
  const data = new Uint8Array(TILE * TILE * 4)
  for (let row = 0; row < TILE; row += 1) {
    for (let col = 0; col < TILE; col += 1) {
      const [r, g, b, h] = texelOf(kind, col / TILE, row / TILE)
      const at = (row * TILE + col) * 4
      data[at] = Math.round(clamp01(r) * 255)
      data[at + 1] = Math.round(clamp01(g) * 255)
      data[at + 2] = Math.round(clamp01(b) * 255)
      data[at + 3] = Math.round(clamp01(h) * 255)
    }
  }
  return { kind, data }
}
