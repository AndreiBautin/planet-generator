import type { Vec3 } from './cube'
import { FREEZES } from './features'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Where a world's birds wheel: at most one flock to a cell of the drainage
 * map, decided by the cell and the seed alone, so a flock is always over
 * the same valley however the eye came to it. Dark land birds over wet
 * ground — fewer the drier it is — and white seabirds over the sea, more of
 * them near a coast. None on a molten world, and none where it is cold
 * enough for the water to ice (features.ts).
 */
export interface Flock {
  /** The point it wheels round, a unit direction. */
  readonly at: Vec3
  /** Seabirds, pale, or land birds, dark. */
  readonly sea: boolean
  /** How many birds. */
  readonly birds: number
  /** 0 to 1: everything else about it — how wide it wheels, how high, which way. */
  readonly seed: number
}

/** The most birds in a flock. */
export const MOST_BIRDS = 12
const FEWEST_BIRDS = 5
/** How far above freezing birds need it, as for the waterfalls. */
const THAWED = 0.3

export function flockIn(planet: Planet, cell: number): Flock | undefined {
  if (planet.molten) return undefined
  const roll = hashed(planet.seed, cell)
  const centre = cellCentre(cell)
  // Anywhere well inside the cell, not on a grid of cell centres.
  const at = unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.6,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.6,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.6,
  ])
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.biome === 'snow' || surface.warmth < FREEZES + THAWED) return undefined
  const sea = surface.height < 0
  const chance = sea
    ? // Gulls keep to the coasts: most over shallows, a few far out.
      surface.biome === 'shallow' || surface.biome === 'shore'
      ? 0.3
      : 0.06
    : 0.12 + 0.28 * Math.min(1, surface.moisture * 1.4)
  if (roll(0) >= chance) return undefined
  return {
    at,
    sea,
    birds: FEWEST_BIRDS + Math.floor(roll(4) * (MOST_BIRDS - FEWEST_BIRDS + 1)),
    seed: roll(5),
  }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Numbers 0 to 1 fixed by a seed and a cell, one for each slot asked for. */
function hashed(seed: string, cell: number): (slot: number) => number {
  let base = 2166136261
  for (let k = 0; k < seed.length; k += 1) base = Math.imul(base ^ seed.charCodeAt(k), 16777619)
  base = Math.imul(base ^ cell, 16777619)
  return (slot) => {
    let h = Math.imul(base ^ Math.imul(slot + 1, 0x9e3779b1), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
}
