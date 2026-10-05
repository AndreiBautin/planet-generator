import { FEATURES, featuresAt, NOTHING, type Feature } from '@/generation/features'
import { fbm } from '@/generation/noise'
import { surfaceAt, type Planet } from '@/generation/planet'
import { hashSeed } from '@/generation/rng'

import { fromPalette } from '../colour'
import { SEA_RADIUS } from '../water'
import { directionOn, patchUv, type PatchKey } from './cube'
import { groundRadiusAt } from './patch-data'

/**
 * The features standing on — or floating over — a patch: trees, scrub,
 * cacti, rocks, boulders, spires and ice floes, each one placed, turned,
 * sized and tinted on its own.
 *
 * Where they stand comes from a grid laid over each face of the cube at a
 * fixed spacing, not from the patch: a patch takes the grid cells inside
 * it, and each cell's feature is decided by a hash of the cell. So a tree is
 * the same tree whatever patch carries it, and nothing reshuffles. Within the
 * grid, groves and clearings come from a noise field, and what stands in a
 * cell from `featuresAt` — the same moisture, warmth and height the ground
 * is painted with.
 *
 * Features come in tiles of their own, patches at `SCATTER_LEVEL` asked for
 * near the camera whatever level the ground there is drawn at (see
 * flora.ts). Each stands on the true ground, which the drawn ground at that
 * distance follows to well within a feature's height; a floe floats on the
 * sea.
 */
export const SCATTER_LEVEL = 7
/** Grid spacing on a face, in face coordinates (−1 to 1 across the face). */
export const CELL = 0.0009
/** Floats per feature: position (3), size, turn, colour (3). */
export const STRIDE = 8

export type Scatter = Readonly<Partial<Record<Feature, Float32Array>>>

/** Hash a cell to a number in [0, 1), from a seed word, the cell and a salt. */
function cellHash(seedWord: number, face: number, i: number, j: number, salt: number): number {
  let h = seedWord ^ Math.imul(face + 1, 0x9e3779b1)
  h = Math.imul(h ^ i, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ j, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16) ^ salt, 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Living things clump into groves; stone and ice lie where they fell. */
const CLUMPS: Readonly<Record<Feature, boolean>> = {
  broadleaf: true,
  conifer: true,
  shrub: true,
  cactus: true,
  rock: false,
  boulder: false,
  spire: false,
  floe: false,
}

export function scatterPatch(planet: Planet, key: PatchKey): Scatter {
  if (key.level < SCATTER_LEVEL) return {}
  const [u0, v0] = patchUv(key, 0, 0)
  const [u1, v1] = patchUv(key, 1, 1)
  const word = hashSeed(`${planet.seed}/features`)[0]
  const found: Record<Feature, number[]> = {
    broadleaf: [],
    conifer: [],
    shrub: [],
    cactus: [],
    rock: [],
    boulder: [],
    spire: [],
    floe: [],
  }
  const [ox, oy, oz] = planet.offset
  const palette: Palette = {
    lush: fromPalette(planet.palette.lush),
    dry: fromPalette(planet.palette.dry),
    highland: fromPalette(planet.palette.highland),
    peak: fromPalette(planet.palette.peak),
    ice: fromPalette(planet.palette.ice),
    shallow: fromPalette(planet.palette.shallow),
  }

  // Cells whose corner lies in [u0, u1) × [v0, v1): half-open, so a cell on
  // the edge two patches share belongs to exactly one of them.
  for (let j = Math.ceil(v0 / CELL); j * CELL < v1; j += 1) {
    for (let i = Math.ceil(u0 / CELL); i * CELL < u1; i += 1) {
      const u = (i + 0.15 + cellHash(word, key.face, i, j, 1) * 0.7) * CELL
      const v = (j + 0.15 + cellHash(word, key.face, i, j, 2) * 0.7) * CELL
      const direction = directionOn(key.face, u, v)
      const [x, y, z] = direction
      const surface = surfaceAt(planet, x, y, z)
      const atSea = surface.height < 0
      // Open water carries nothing: skip the slope sampling there.
      if (atSea && featuresAt(planet, surface, 0) === NOTHING) continue

      const here = groundRadiusAt(planet, direction)
      let steep = 0
      if (!atSea) {
        // Slope from two neighbours a fraction of a cell away.
        const eastward = groundRadiusAt(planet, directionOn(key.face, u + CELL * 0.3, v))
        const northward = groundRadiusAt(planet, directionOn(key.face, u, v + CELL * 0.3))
        const run = CELL * 0.3 * 0.785
        const rise = Math.hypot(eastward - here, northward - here) / run
        steep = 1 - 1 / Math.sqrt(1 + rise * rise)
      }

      const growth = featuresAt(planet, surface, steep)
      const grove =
        fbm(planet.fine, (x + oy) * 70, (y + oz) * 70, (z + ox) * 70, 3) * 0.6 +
        fbm(planet.fine, (x - oz) * 320, (y + ox) * 320, (z - oy) * 320, 2) * 0.4
      const thicket = clamp01((grove + 0.25) / 0.6)
      const roll = cellHash(word, key.face, i, j, 3)
      let under = 0
      let feature: Feature | undefined
      for (const candidate of FEATURES) {
        under += growth[candidate] * (CLUMPS[candidate] ? thicket * 1.4 : 1)
        if (roll < under) {
          feature = candidate
          break
        }
      }
      if (feature === undefined) continue

      const a = cellHash(word, key.face, i, j, 4)
      const b = cellHash(word, key.face, i, j, 5)
      const c = cellHash(word, key.face, i, j, 6)
      const size = sizeOf(feature, a)
      const colour = colourOf(feature, palette, surface.warmth, planet.molten, b, c)
      // A floe rides the sea; everything else is set a little into the
      // ground, so a trunk on a slope is not floating.
      const radius =
        feature === 'floe'
          ? SEA_RADIUS + 0.00001
          : here - (feature === 'rock' || feature === 'boulder' ? 0.00012 * size : 0.00004)
      found[feature].push(x * radius, y * radius, z * radius, size, c * Math.PI * 2, ...colour)
    }
  }

  const scatter: Partial<Record<Feature, Float32Array>> = {}
  for (const feature of FEATURES) {
    if (found[feature].length > 0) scatter[feature] = Float32Array.from(found[feature])
  }
  return scatter
}

function sizeOf(feature: Feature, roll: number): number {
  switch (feature) {
    case 'broadleaf':
      return 0.8 + roll * 0.65
    case 'conifer':
      return 0.7 + roll * 0.8
    case 'shrub':
      return 0.45 + roll * 0.45
    case 'cactus':
      return 0.6 + roll * 0.5
    case 'rock':
      return 0.3 + roll * roll * 0.8
    case 'boulder':
      return 1 + roll * roll * 1.5
    case 'spire':
      return 0.9 + roll * 1.6
    case 'floe':
      return 1.5 + roll * 3
  }
}

interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

interface Palette {
  readonly lush: Rgb
  readonly dry: Rgb
  readonly highland: Rgb
  readonly peak: Rgb
  readonly ice: Rgb
  readonly shallow: Rgb
}

type Triple = [number, number, number]

const blend = (a: Rgb, b: Rgb, t: number): Triple => [
  a.r + (b.r - a.r) * t,
  a.g + (b.g - a.g) * t,
  a.b + (b.b - a.b) * t,
]
const scaled = (c: Triple, k: number): Triple => [c[0] * k, c[1] * k, c[2] * k]
const towards = (c: Triple, to: Rgb, t: number): Triple => [
  c[0] + (to.r - c[0]) * t,
  c[1] + (to.g - c[1]) * t,
  c[2] + (to.b - c[2]) * t,
]

/**
 * Each feature its own shade: no two trees in a wood are the same green and
 * no two floes the same white. A broadleaf leans towards the dry colour or
 * the lush by chance, and the odd one on cooler ground has turned; a pine
 * near the snow carries some; ice takes a little of the sea.
 */
function colourOf(
  feature: Feature,
  palette: Palette,
  warmth: number,
  molten: boolean,
  shade: number,
  pick: number,
): Triple {
  const light = 0.72 + shade * 0.45
  switch (feature) {
    case 'broadleaf': {
      // Leaves are green first and the planet's palette second: an ochre
      // world's "lush" made orange trees that read as dead ones.
      const leaf = towards(scaled([0.1, 0.24, 0.06], 1), palette.lush, 0.3 + pick * 0.25)
      const turned = warmth < 0.2 && pick > 0.88
      return scaled(turned ? [0.55, 0.22, 0.04] : leaf, light * 0.85)
    }
    case 'conifer': {
      const needles = towards([0.05, 0.14, 0.06], palette.lush, 0.2 + pick * 0.2)
      // Snow lies on the branches the colder it gets: below the snow line a
      // pine is more white than green, or it reads as a black post on the ice.
      return scaled(towards(needles, palette.ice, clamp01((-0.15 - warmth) * 2.5) * 0.85), light)
    }
    case 'shrub':
      return scaled(blend(palette.dry, palette.lush, 0.25 + pick * 0.4), light * 0.8)
    case 'cactus':
      return scaled([0.12 + pick * 0.05, 0.26 + pick * 0.06, 0.1], light)
    case 'rock':
    case 'boulder':
      return molten
        ? scaled([0.05, 0.045, 0.04], 0.8 + shade * 0.5)
        : scaled(blend(palette.highland, palette.peak, pick * 0.8), light * 0.9)
    case 'spire':
      // Basalt on a volcanic world; ice everywhere else a spire stands.
      return molten
        ? scaled([0.035, 0.03, 0.03], 0.8 + shade * 0.6)
        : scaled(blend(palette.ice, palette.shallow, 0.15 + pick * 0.25), 0.85 + shade * 0.2)
    case 'floe':
      return scaled(blend(palette.ice, palette.shallow, pick * 0.2), 0.9 + shade * 0.15)
  }
}
