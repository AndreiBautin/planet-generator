import { hashed } from './birds'
import type { Vec3 } from './cube'
import { FREEZES } from './features'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Where a world's fish swim: at most one school to a cell of the drainage
 * map, under the sea, decided by the cell and the seed alone so a school
 * is always in the same water — the birds' arrangement (birds.ts), under
 * the surface. More in warm water than cold, none where it ices over,
 * none on a molten world. Three kinds, which only the colour tells apart.
 */
export interface School {
  /** The point it circles, a unit direction. */
  readonly at: Vec3
  /** How many fish. */
  readonly fish: number
  /** 0 silver, 1 blue, 2 orange. */
  readonly kind: number
  /** 0 to 1: everything else — how wide it circles, how deep, which way. */
  readonly seed: number
}

/** The most fish in a school. */
export const MOST_FISH = 16
const FEWEST_FISH = 6

export function schoolIn(planet: Planet, cell: number): School | undefined {
  if (planet.molten) return undefined
  // Their own rolls, apart from the birds over the same cell.
  const roll = hashed(`${planet.seed}~fish`, cell)
  const centre = cellCentre(cell)
  const at: Vec3 = unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.6,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.6,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.6,
  ])
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.height >= 0 || surface.warmth < FREEZES + 0.3) return undefined
  const chance = 0.4 + 0.45 * Math.min(1, Math.max(0, surface.warmth + 0.2))
  if (roll(0) >= chance) return undefined
  return {
    at,
    fish: FEWEST_FISH + Math.floor(roll(4) * (MOST_FISH - FEWEST_FISH + 1)),
    // Bright reef fish only where it is warm.
    kind: surface.warmth > 0.3 ? Math.floor(roll(5) * 3) : Math.floor(roll(5) * 2),
    seed: roll(6),
  }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
