import {
  FEATURES,
  featuresAt,
  floorAt,
  NOTHING,
  type Feature,
  type Growth,
} from '@/generation/features'
import { groupingsAt } from '@/generation/grouping'
import { surfaceAt, type Planet, type Surface } from '@/generation/planet'
import { hashSeed } from '@/generation/rng'

import { fromPalette } from '../colour'
import { SEA_RADIUS } from '../water'
import { directionOn, patchUv, type PatchKey } from './cube'
import { groundRadiusAt } from './patch-data'

/**
 * The features that make up a patch of ground: trees, scrub, grass, cacti,
 * rocks, boulders, basalt columns, cinder cones and ice floes, each one
 * placed, turned, sized and tinted on its own.
 *
 * Where they stand comes from a grid laid over each face of the cube at a
 * fixed spacing, not from the patch: a patch takes the grid cells inside
 * it, and each cell's features are decided by a hash of the cell. So a tree
 * is the same tree whatever patch carries it, and nothing reshuffles. Every
 * cell can hold two things — one standing (`featuresAt`) and one on the
 * floor (`floorAt`) — so a wood has its undergrowth and a desert its rock
 * among the cacti.
 *
 * Within the grid, how things group is a noise field per kind of grouping:
 * living things gather into groves with clearings between, desert rock and
 * cacti into outcrops and stands, basalt columns into pavements. Ice floes
 * and cones lie where they fell.
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

type Grouping = 'grove' | 'outcrop' | 'pavement' | 'none'

/** How each kind groups: the noise its density follows. */
const GROUPING: Readonly<Record<Feature, Grouping>> = {
  broadleaf: 'grove',
  conifer: 'grove',
  shrub: 'grove',
  grass: 'grove',
  cactus: 'outcrop',
  rock: 'outcrop',
  boulder: 'outcrop',
  spire: 'pavement',
  cone: 'none',
  floe: 'none',
}

interface Groupings {
  readonly grove: number
  readonly outcrop: number
  readonly pavement: number
  readonly none: number
}

/** Pick one feature from a layer by a roll, each weighted by its grouping. */
function pick(growth: Growth, groups: Groupings, roll: number): Feature | undefined {
  let under = 0
  for (const candidate of FEATURES) {
    const chance = growth[candidate]
    if (chance === 0) continue
    under += chance * groups[GROUPING[candidate]]
    if (roll < under) return candidate
  }
  return undefined
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
    grass: [],
    cactus: [],
    rock: [],
    boulder: [],
    spire: [],
    cone: [],
    floe: [],
  }
  const palette: Palette = {
    lush: fromPalette(planet.palette.lush),
    dry: fromPalette(planet.palette.dry),
    highland: fromPalette(planet.palette.highland),
    peak: fromPalette(planet.palette.peak),
    ice: fromPalette(planet.palette.ice),
    shallow: fromPalette(planet.palette.shallow),
  }

  const place = (
    feature: Feature,
    direction: readonly [number, number, number],
    here: number,
    surface: Surface,
    rolls: readonly [number, number, number],
  ): void => {
    const [a, b, c] = rolls
    const size = sizeOf(feature, a)
    const colour = colourOf(feature, palette, surface, planet.molten, b, c)
    const [x, y, z] = direction
    const radius = radiusOf(feature, here, size, surface)
    found[feature].push(x * radius, y * radius, z * radius, size, c * Math.PI * 2, ...colour)
  }

  // Cells whose corner lies in [u0, u1) × [v0, v1): half-open, so a cell on
  // the edge two patches share belongs to exactly one of them.
  for (let j = Math.ceil(v0 / CELL); j * CELL < v1; j += 1) {
    for (let i = Math.ceil(u0 / CELL); i * CELL < u1; i += 1) {
      const u = (i + 0.1 + cellHash(word, key.face, i, j, 1) * 0.8) * CELL
      const v = (j + 0.1 + cellHash(word, key.face, i, j, 2) * 0.8) * CELL
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

      // The groupings the ground is painted by too (grouping.ts): a grove
      // is broad with clearings, an outcrop tighter and sharper-edged, a
      // pavement a patch of ground that is all columns or none.
      const grouping = groupingsAt(planet, x, y, z)
      const groups: Groupings = {
        grove: grouping.grove * 1.4,
        outcrop: grouping.outcrop * 1.6,
        // Only lava cools into pavements; an ice serac stands with the rock.
        pavement: planet.molten ? 0.08 + grouping.pavement * 2.1 : grouping.outcrop * 1.6,
        none: 1,
      }

      const standing = pick(
        featuresAt(planet, surface, steep),
        groups,
        cellHash(word, key.face, i, j, 3),
      )
      if (standing !== undefined) {
        place(standing, direction, here, surface, [
          cellHash(word, key.face, i, j, 4),
          cellHash(word, key.face, i, j, 5),
          cellHash(word, key.face, i, j, 6),
        ])
      }
      if (atSea) continue

      const cover = pick(floorAt(planet, surface, steep), groups, cellHash(word, key.face, i, j, 7))
      if (cover !== undefined) {
        // The floor's own spot in the cell, so it is not under the trunk.
        const fu = (i + 0.1 + cellHash(word, key.face, i, j, 8) * 0.8) * CELL
        const fv = (j + 0.1 + cellHash(word, key.face, i, j, 9) * 0.8) * CELL
        const at = directionOn(key.face, fu, fv)
        place(cover, at, groundRadiusAt(planet, at), surface, [
          cellHash(word, key.face, i, j, 10),
          cellHash(word, key.face, i, j, 11),
          cellHash(word, key.face, i, j, 12),
        ])
      }
    }
  }

  const scatter: Partial<Record<Feature, Float32Array>> = {}
  for (const feature of FEATURES) {
    if (found[feature].length > 0) scatter[feature] = Float32Array.from(found[feature])
  }
  return scatter
}

/**
 * A floe rides the sea and a ridge of pack ice is heaved up just under its
 * surface; everything else is set a little into the ground, so a trunk on
 * a slope is not floating.
 */
function radiusOf(feature: Feature, ground: number, size: number, surface: Surface): number {
  if (feature === 'floe') return SEA_RADIUS + 0.00001
  if (surface.height < 0) return SEA_RADIUS - 0.00003
  switch (feature) {
    case 'rock':
      // Half buried: a rock is part of the ground, not set on it.
      return ground - 0.00022 * size
    case 'boulder':
      return ground - 0.00016 * size
    case 'cone':
      return ground - 0.0003
    case 'broadleaf':
    case 'conifer':
    case 'shrub':
    case 'grass':
    case 'cactus':
    case 'spire':
      return ground - 0.00004
  }
}

function sizeOf(feature: Feature, roll: number): number {
  switch (feature) {
    case 'broadleaf':
      return 0.55 + roll * 0.95
    case 'conifer':
      return 0.6 + roll * 1.0
    case 'shrub':
      return 0.4 + roll * 0.5
    case 'grass':
      return 0.3 + roll * 0.3
    case 'cactus':
      return 0.4 + roll * 0.6
    case 'rock':
      return 0.3 + roll * roll * 0.8
    case 'boulder':
      return 1 + roll * roll * 1.5
    case 'spire':
      return 0.7 + roll * 1.2
    case 'cone':
      return 3 + roll * 4
    case 'floe':
      return 1.4 + roll * 3.2
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
 * near the snow carries some; grass follows the ground's moisture; ice
 * takes a little of the sea.
 */
function colourOf(
  feature: Feature,
  palette: Palette,
  surface: Surface,
  molten: boolean,
  shade: number,
  pick: number,
): Triple {
  const light = 0.72 + shade * 0.45
  const warmth = surface.warmth
  switch (feature) {
    case 'broadleaf': {
      // Leaves are green first and the planet's palette second: an ochre
      // world's "lush" made orange trees that read as dead ones.
      const leaf = towards([0.1, 0.24, 0.06], palette.lush, 0.3 + pick * 0.25)
      const turned = warmth < 0.2 && pick > 0.88
      return scaled(turned ? [0.55, 0.22, 0.04] : leaf, light * 0.85)
    }
    case 'conifer': {
      const needles = towards([0.05, 0.14, 0.06], palette.lush, 0.2 + pick * 0.2)
      // Snow lies on the branches where the ground is snow: a pine on a
      // snowfield is more white than green, or it reads as a black post on
      // the ice; one on bare cold ground is only dusted.
      const snowy = surface.biome === 'snow' ? 0.8 : clamp01((-0.4 - warmth) * 4) * 0.3
      return scaled(towards(needles, palette.ice, snowy), light)
    }
    case 'shrub': {
      const dry = 1 - clamp01((surface.moisture - 0.15) / 0.4)
      return scaled(blend(palette.dry, palette.lush, 0.25 + pick * 0.4 - dry * 0.3), light * 0.8)
    }
    case 'grass': {
      // The ground's own colour grown up: lusher where it is wet, straw
      // where it is dry, never a different green from the turf it stands in.
      const soil = fromPalette(surface.colour)
      const wet = clamp01((surface.moisture - 0.15) / 0.5)
      const straw = towards([soil.r, soil.g, soil.b], { r: 0.55, g: 0.46, b: 0.2 }, 0.5)
      return scaled(towards(straw, palette.lush, wet * (0.4 + pick * 0.3)), light * 1.05)
    }
    case 'cactus':
      return scaled([0.12 + pick * 0.05, 0.26 + pick * 0.06, 0.1], light)
    case 'rock':
    case 'boulder': {
      if (surface.height < 0) return scaled(blend(palette.ice, palette.shallow, pick * 0.3), 0.9)
      if (molten) return scaled([0.05, 0.045, 0.04], 0.8 + shade * 0.5)
      // Stone the colour of the ground it came out of, greyed towards the
      // peaks: a desert's rock is red and a highland's is grey.
      const soil = fromPalette(surface.colour)
      const stone = blend(palette.highland, palette.peak, pick * 0.8)
      return scaled(towards(stone, soil, 0.35 + (1 - surface.moisture) * 0.25), light * 0.9)
    }
    case 'spire':
      // Basalt on a volcanic world; ice everywhere else a spire stands.
      return molten
        ? scaled([0.035, 0.03, 0.03], 0.8 + shade * 0.6)
        : scaled(blend(palette.ice, palette.shallow, 0.15 + pick * 0.25), 0.85 + shade * 0.2)
    case 'cone':
      return scaled([0.09, 0.05, 0.04], 0.8 + shade * 0.4)
    case 'floe':
      return scaled(blend(palette.ice, palette.shallow, pick * 0.2), 0.9 + shade * 0.15)
  }
}
