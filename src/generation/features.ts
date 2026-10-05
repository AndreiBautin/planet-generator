import type { Planet, Surface } from './planet'

/**
 * What stands on a piece of ground — or floats on a piece of sea — and how
 * thickly: the rule the scattered features follow.
 *
 * Every biome gets its own: a wood of separate trees where the ground is
 * wet and warm, pines as it cools and climbs, cacti and scrub where it is
 * hot and dry, hardy pines and ice spires below the snow line, boulders
 * strewn over high ground, basalt spires on a volcanic world, sea stacks
 * off a coast, and ice floes adrift on a cold sea. Each is a reading of the
 * same fields the biomes are painted from — moisture, warmth, height — so a
 * feature always agrees with the colour of the ground under it.
 *
 * Pure, and drawn from no randomness at all: where exactly each one stands
 * is the scatterer's business, with its own seeded hash.
 */
export const FEATURES = [
  'broadleaf',
  'conifer',
  'shrub',
  'cactus',
  'rock',
  'boulder',
  'spire',
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
  cactus: 0,
  rock: 0,
  boulder: 0,
  spire: 0,
  floe: 0,
}

/** Where the sea freezes over, as `biomeFor` decides it. */
const FREEZES = -0.45

/**
 * What is at this spot. `steep` is one minus the cosine of the ground's
 * slope: nothing roots on a cliff, and a cliff is where rock shows.
 */
export function featuresAt(planet: Planet, surface: Surface, steep: number): Growth {
  if (surface.height < 0) {
    if (planet.molten) return NOTHING
    // Pack ice breaks into floes towards its edge; open sea just past it
    // carries a scattering of them.
    const floes =
      surface.warmth < FREEZES ? 0.55 : smooth(FREEZES + 0.2, FREEZES, surface.warmth) * 0.18
    // A rock or two standing off the coast in the shallows.
    const stacks = surface.height > -0.012 ? 0.004 : 0
    return { ...NOTHING, floe: floes, boulder: stacks }
  }
  if (surface.height <= 0.01) return NOTHING

  const cliff = smooth(0.08, 0.2, steep)
  const high = smooth(0.4, 0.8, surface.height)
  const rock = Math.min(0.45, 0.012 + cliff * 0.35 + high * 0.12)
  const boulder = 0.004 + high * 0.035 + cliff * 0.03

  if (planet.molten) {
    // Black rock, and basalt standing in columns where lava cooled.
    return {
      ...NOTHING,
      rock: Math.min(0.55, rock * 2.5),
      boulder: boulder * 1.5,
      spire: 0.012 + cliff * 0.05,
    }
  }
  if (surface.biome === 'snow' || surface.biome === 'sea-ice') {
    // A few hardy pines just below the snow line, ice standing up on the
    // steep ground, and stone poking through.
    const pines = smooth(-0.55, -0.32, surface.warmth) * 0.25 * (1 - cliff)
    return { ...NOTHING, conifer: pines, rock: rock * 0.6, boulder, spire: cliff * 0.12 + 0.01 }
  }
  if (surface.biome === 'shore') return { ...NOTHING, shrub: 0.05, rock: 0.05, boulder: 0.01 }

  const living = 1 - cliff
  const wet = surface.moisture
  const warm = surface.warmth
  // Forest needs water; broadleaf likes it warm, pines take over as it
  // cools and climbs.
  // Too hot and the forest gives out, however wet: an oasis, not a jungle.
  const forest =
    smooth(0.42, 0.72, wet) * smooth(-0.3, 0.05, warm) * (1 - smooth(0.55, 0.9, warm)) * living
  const highland = surface.biome === 'highland' ? 1 : smooth(0.2, 0.42, surface.height)
  const cool = 1 - smooth(0.05, 0.55, warm)
  const pineShare = Math.min(1, cool * 0.8 + highland * 0.7)
  // Too hot and dry for trees: cacti, scrub, and more bare rock.
  const desert = smooth(0.45, 0.8, warm) * (1 - smooth(0.35, 0.6, wet)) * living
  const scrub = smooth(0.15, 0.45, wet) * (1 - forest) * living * 0.35
  return {
    ...NOTHING,
    broadleaf: forest * (1 - pineShare) * 0.82,
    conifer: forest * pineShare * 0.82,
    shrub: scrub + desert * 0.18,
    cactus: desert * 0.16,
    rock: rock + desert * 0.05,
    boulder,
  }
}

/**
 * How the ground itself reads close up, as four weights the ground shader
 * draws as patterns: canopy (a forest seen from above, as crowns), sand
 * (rippled by wind), snow (carved into ridges), stone (cracked). Each is 0
 * to 1; they need not sum to one.
 */
export interface GroundPattern {
  readonly canopy: number
  readonly sand: number
  readonly snow: number
  readonly stone: number
}

export function patternAt(planet: Planet, surface: Surface, steep: number): GroundPattern {
  if (surface.height < 0) return { canopy: 0, sand: 0, snow: 0, stone: 0 }
  const growth = featuresAt(planet, surface, steep)
  const cliff = smooth(0.06, 0.2, steep)
  const high = smooth(0.35, 0.7, surface.height)
  if (planet.molten) return { canopy: 0, sand: 0, snow: 0, stone: 1 }
  const snow = surface.biome === 'snow' ? 1 - cliff * 0.6 : 0
  const beach = surface.biome === 'shore' ? 1 : 0
  const dry = smooth(0.35, 0.8, surface.warmth) * (1 - smooth(0.3, 0.6, surface.moisture))
  return {
    canopy: Math.min(1, (growth.broadleaf + growth.conifer) * 1.3 + growth.shrub * 0.5),
    sand: Math.min(1, Math.max(beach, dry * (1 - high) * (1 - snow))),
    snow,
    stone: Math.min(1, cliff + high * 0.6),
  }
}
