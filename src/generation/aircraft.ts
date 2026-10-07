import { hashed } from './birds'
import type { Vec3 } from './cube'
import { FREEZES } from './features'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Things in the sky: a meet of hot-air balloons drifting over the land, and
 * now and then an airship cruising over land or sea. At most one of each to
 * a cell of the drainage map, decided by the cell and the seed alone on
 * rolls of their own. None on a molten world; balloons only over thawed
 * land, since nobody goes up over the ice for the view.
 */
export interface Balloons {
  /** The point the meet drifts round, a unit direction. */
  readonly at: Vec3
  readonly balloons: number
  readonly seed: number
}

export interface Airship {
  /** The point its round is centred on, a unit direction. */
  readonly at: Vec3
  readonly seed: number
}

/** The most balloons in a meet. */
export const MOST_BALLOONS = 4

export function balloonsIn(planet: Planet, cell: number): Balloons | undefined {
  if (planet.molten) return undefined
  const roll = hashed(`${planet.seed}~balloons`, cell)
  if (roll(0) >= 0.05) return undefined
  const at = near(cell, roll)
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.height <= 0.01 || surface.biome === 'snow' || surface.warmth < FREEZES + 0.3) {
    return undefined
  }
  return { at, balloons: 1 + Math.floor(roll(4) * MOST_BALLOONS), seed: roll(5) }
}

export function airshipIn(planet: Planet, cell: number): Airship | undefined {
  if (planet.molten) return undefined
  const roll = hashed(`${planet.seed}~airship`, cell)
  if (roll(0) >= 0.015) return undefined
  return { at: near(cell, roll), seed: roll(4) }
}

function near(cell: number, roll: (slot: number) => number): Vec3 {
  const centre = cellCentre(cell)
  const v: Vec3 = [
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.6,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.6,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.6,
  ]
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
