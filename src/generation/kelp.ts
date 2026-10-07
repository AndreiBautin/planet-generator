import { hashed } from './birds'
import type { Vec3 } from './cube'
import { FREEZES } from './features'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Where a world's kelp grows: at most one forest to a cell of the drainage
 * map, decided by the cell and the seed alone — the fish's arrangement
 * (fish.ts) on rolls of its own. **Kelp is the cool sea's reef**: it grows
 * where the water is cold enough that coral does not (patch-data.ts lays
 * reefs from a warmth of 0.1 up) and open, never where the sea ices over.
 * How deep the bed is decides which stalks grow, and that is the
 * drawing's to read (render/kelp.ts), since the bed is the drawn ground.
 */
export interface Forest {
  /** Its middle, a unit direction. */
  readonly at: Vec3
  /** How far it spreads, in radians. */
  readonly spread: number
  /** 0 to 1: everything else — which stalks, how they lean, their colour. */
  readonly seed: number
}

/** Warmer than this, the sea grows coral rather than kelp. */
export const KELP_WARMEST = 0.2

export function forestIn(planet: Planet, cell: number): Forest | undefined {
  if (planet.molten) return undefined
  const roll = hashed(`${planet.seed}~kelp`, cell)
  const centre = cellCentre(cell)
  const at = unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.5,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.5,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.5,
  ])
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.height >= 0) return undefined
  if (surface.warmth < FREEZES + 0.3 || surface.warmth > KELP_WARMEST) return undefined
  if (roll(0) >= 0.7) return undefined
  return { at, spread: CELL_ANGLE * (0.25 + 0.2 * roll(4)), seed: roll(5) }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
