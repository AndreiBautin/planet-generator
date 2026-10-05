import type { Planet, Surface } from './planet'

/**
 * What a piece of ground is made of close up: the rule the scattered
 * features follow.
 *
 * A biome is not a colour with things dropped on it; it is the things. A
 * forest is trees standing crown to crown with scrub and grass in the gaps,
 * a desert is dunes with cacti and rock in clusters, pack ice is plates of
 * ice edge to edge with pressure ridges between, a lava field is columns,
 * cones and black rubble. So the densities here run close to one where a
 * biome is at its fullest, and the ground shader underneath draws the floor
 * of that biome rather than a picture of it.
 *
 * Two layers per spot, each at most one thing: what *stands* (`featuresAt`
 * — trees, cacti, boulders, columns, cones, floes) and what covers the
 * *floor* under and between them (`floorAt` — scrub, grass, rock). Both are
 * readings of the same fields the biomes are painted from — moisture,
 * warmth, height, slope — and of the planet's kind, so an arid world is
 * desert wherever it is dry enough and never grows a forest from a damp
 * patch of its noise.
 *
 * Pure, and drawn from no randomness at all: where exactly each one stands
 * is the scatterer's business, with its own seeded hash.
 */
export const FEATURES = [
  'broadleaf',
  'conifer',
  'shrub',
  'grass',
  'cactus',
  'rock',
  'boulder',
  'spire',
  'cone',
  'floe',
] as const
export type Feature = (typeof FEATURES)[number]

/** The chance of each feature at a candidate spot, 0 to 1 each; their sum is the chance anything is there. */
export type Growth = Readonly<Record<Feature, number>>

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

export const NOTHING: Growth = {
  broadleaf: 0,
  conifer: 0,
  shrub: 0,
  grass: 0,
  cactus: 0,
  rock: 0,
  boulder: 0,
  spire: 0,
  cone: 0,
  floe: 0,
}

/** Where the sea freezes over, as `biomeFor` decides it. */
const FREEZES = -0.45

/** The terms every land rule reads, computed once per spot. */
interface Terms {
  readonly cliff: number
  readonly high: number
  readonly living: number
  /** Closed forest, 0 to 1: wet, mild, flat ground. */
  readonly forest: number
  /** Of the forest, how much is pine. */
  readonly pineShare: number
  /** Hot dry ground, 0 to 1 — all of an arid world's lowland. */
  readonly desert: number
  /** Cold, damp, below the snow: the boreal belt. */
  readonly boreal: number
}

function termsOf(planet: Planet, surface: Surface, steep: number): Terms {
  const cliff = smooth(0.08, 0.2, steep)
  const high = smooth(0.4, 0.8, surface.height)
  const living = 1 - cliff
  const wet = surface.moisture
  const warm = surface.warmth
  const arid = planet.kind === 'arid'
  // Forest needs water and a mild climate: too hot and it gives out however
  // wet (an oasis, not a jungle); an arid world grows none at all.
  const forest = arid
    ? 0
    : smooth(0.38, 0.62, wet) * smooth(-0.35, 0.0, warm) * (1 - smooth(0.55, 0.9, warm)) * living
  const boreal = arid
    ? 0
    : smooth(0.28, 0.5, wet) * smooth(-0.6, -0.4, warm) * (1 - smooth(-0.15, 0.1, warm)) * living
  const highland = surface.biome === 'highland' ? 1 : smooth(0.2, 0.42, surface.height)
  const cool = 1 - smooth(0.05, 0.55, warm)
  const pineShare = Math.min(1, cool * 0.8 + highland * 0.7)
  const desert = arid
    ? living * (1 - smooth(0.6, 0.9, wet))
    : smooth(0.45, 0.8, warm) * (1 - smooth(0.35, 0.6, wet)) * living
  return { cliff, high, living, forest, pineShare, desert, boreal }
}

/**
 * What stands at this spot. `steep` is one minus the cosine of the ground's
 * slope: nothing roots on a cliff, and a cliff is where rock shows.
 */
export function featuresAt(planet: Planet, surface: Surface, steep: number): Growth {
  if (surface.height < 0) {
    if (planet.molten) return NOTHING
    // Pack ice: plates edge to edge with pressure ridges heaved up between
    // them; towards its edge it breaks up, and open sea just past it carries
    // a scattering of floes.
    if (surface.warmth < FREEZES) return { ...NOTHING, floe: 0.88, boulder: 0.06 }
    const floes = smooth(FREEZES + 0.2, FREEZES, surface.warmth) * 0.3
    // A rock or two standing off the coast in the shallows.
    const stacks = surface.height > -0.012 ? 0.004 : 0
    return { ...NOTHING, floe: floes, boulder: stacks }
  }
  if (surface.height <= 0.01) return NOTHING

  const { cliff, high, living, forest, pineShare, desert, boreal } = termsOf(planet, surface, steep)
  const boulder = 0.004 + high * 0.035 + cliff * 0.03

  if (planet.molten) {
    // A lava field: basalt standing in columns where it cooled slowly (the
    // scatterer clusters them into pavements), cinder cones on the low
    // ground, and black rubble.
    const low = 1 - smooth(0.12, 0.35, surface.height)
    return {
      ...NOTHING,
      boulder: boulder * 2,
      spire: 0.16 * living + cliff * 0.08,
      cone: 0.0025 * low * living,
    }
  }
  if (surface.biome === 'snow' || surface.biome === 'sea-ice') {
    // Hardy pines just below the snow line, seracs standing on the steep
    // ground, and stone poking through the drifts.
    const pines = smooth(-0.55, -0.32, surface.warmth) * 0.5 * living
    return { ...NOTHING, conifer: pines, boulder, spire: cliff * 0.18 + 0.012 }
  }
  if (surface.biome === 'shore') return { ...NOTHING, boulder: 0.01 }

  const trees = Math.max(forest, boreal) * 0.92
  const pines = Math.max(forest * pineShare, boreal) / Math.max(1e-9, Math.max(forest, boreal))
  const broadleafShare = planet.kind === 'frozen' ? 0 : 1 - pines
  return {
    ...NOTHING,
    broadleaf: trees * broadleafShare,
    conifer: trees * (1 - broadleafShare),
    cactus: desert * 0.12,
    boulder: boulder + desert * 0.03,
  }
}

/**
 * What covers the floor at this spot — scrub, grass, loose rock — under and
 * between whatever stands there. Its own layer, so a forest can have both a
 * tree and the undergrowth beneath it.
 */
export function floorAt(planet: Planet, surface: Surface, steep: number): Growth {
  if (surface.height <= 0.01 || planet.molten) {
    if (planet.molten && surface.height > 0.01) {
      const cliff = smooth(0.08, 0.2, steep)
      const high = smooth(0.4, 0.8, surface.height)
      return { ...NOTHING, rock: Math.min(0.6, 0.12 + cliff * 0.4 + high * 0.15) }
    }
    return NOTHING
  }
  const { cliff, high, living, forest, desert, boreal } = termsOf(planet, surface, steep)
  const rock = Math.min(0.5, 0.012 + cliff * 0.4 + high * 0.15)
  if (surface.biome === 'snow' || surface.biome === 'sea-ice') {
    return { ...NOTHING, rock: rock * 0.5 }
  }
  if (surface.biome === 'shore') return { ...NOTHING, grass: 0.18, shrub: 0.06, rock: 0.05 }

  const wet = surface.moisture
  const warm = surface.warmth
  const wood = Math.max(forest, boreal)
  const open = 1 - wood
  // Grassland where it is damp enough and not baking; a thinner, drier turf
  // under the trees and over the desert's edge.
  const meadow =
    smooth(0.18, 0.45, wet) * (1 - smooth(0.6, 0.9, warm)) * (1 - desert) * open * living
  const grass = Math.min(0.6, meadow * 0.55 + wood * 0.18 + desert * 0.08)
  // Scrub: the understory of a wood, the bush of dry open ground.
  const scrub = smooth(0.12, 0.4, wet) * open * living * 0.22 + wood * 0.3 + desert * 0.14
  return {
    ...NOTHING,
    grass,
    shrub: Math.min(0.5, scrub),
    rock: Math.min(0.45, rock + desert * 0.12),
  }
}

/**
 * How the ground itself reads close up, as four weights the ground shader
 * draws as patterns: canopy (a forest from above as crowns, its floor
 * underneath where single trees stand), sand (rippled by wind), snow
 * (carved into ridges), stone (cracked). On a molten world the sand slot
 * carries the lowland where lava still runs in channels. Each is 0 to 1;
 * they need not sum to one.
 */
export interface GroundPattern {
  readonly canopy: number
  readonly sand: number
  readonly snow: number
  readonly stone: number
}

export function patternAt(planet: Planet, surface: Surface, steep: number): GroundPattern {
  if (surface.height < 0) return { canopy: 0, sand: 0, snow: 0, stone: 0 }
  const cliff = smooth(0.06, 0.2, steep)
  const high = smooth(0.35, 0.7, surface.height)
  if (planet.molten) {
    const low = (1 - smooth(0.03, 0.2, surface.height)) * (1 - cliff)
    return { canopy: 0, sand: low, snow: 0, stone: 1 }
  }
  const growth = featuresAt(planet, surface, steep)
  const snow = surface.biome === 'snow' ? 1 - cliff * 0.6 : 0
  const beach = surface.biome === 'shore' ? 1 : 0
  const dry =
    planet.kind === 'arid'
      ? 1 - smooth(0.6, 0.9, surface.moisture)
      : smooth(0.35, 0.8, surface.warmth) * (1 - smooth(0.3, 0.6, surface.moisture))
  return {
    canopy: Math.min(1, (growth.broadleaf + growth.conifer) * 1.1),
    sand: Math.min(1, Math.max(beach, dry * (1 - high) * (1 - snow) * (1 - cliff))),
    snow,
    stone: Math.min(1, cliff + high * 0.6),
  }
}
