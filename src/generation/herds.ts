import { hashed } from './birds'
import type { Vec3 } from './cube'
import { featuresAt, FREEZES } from './features'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Where a world's herds graze: at most one to a cell of the drainage map,
 * decided by the cell and the seed alone — the birds' arrangement
 * (birds.ts) on the ground, on rolls of their own. On open grass: not in
 * the woods (where they would stand inside the trees), not on the shore,
 * the high ground or the snow, and none where it is too cold for grass or
 * on a molten world. More where it is grassland than scrub.
 *
 * Three kinds, as the land suggests them: pale and tawny on warm dry
 * plains, brown in the temperate grass, dark and shaggy where it is cold.
 */
export interface Herd {
  /** Its middle, a unit direction. */
  readonly at: Vec3
  /** How many animals. */
  readonly beasts: number
  /** 0 tawny, 1 brown, 2 dark. */
  readonly kind: number
  /** 0 to 1: everything else — how they are spread, which way they face. */
  readonly seed: number
}

/** The most animals in a herd. */
export const MOST_BEASTS = 16
const FEWEST_BEASTS = 5
/** More trees than this and it is woodland, not grazing. */
const WOODED = 0.4

export function herdIn(planet: Planet, cell: number): Herd | undefined {
  if (planet.molten) return undefined
  const roll = hashed(`${planet.seed}~herd`, cell)
  const centre = cellCentre(cell)
  const at = unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.6,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.6,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.6,
  ])
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.biome !== 'land' || surface.height <= 0.01) return undefined
  if (surface.warmth < FREEZES + 0.35) return undefined
  // Flat enough ground is the drawing's to check, beast by beast; this is
  // whether the place is grazing at all.
  const growth = featuresAt(planet, surface, 0)
  if (growth.broadleaf + growth.conifer > WOODED) return undefined
  const grass = Math.min(1, Math.max(0, (surface.moisture - 0.12) / 0.3))
  if (roll(0) >= 0.2 + 0.4 * grass) return undefined
  const kind = surface.warmth > 0.08 && surface.moisture < 0.5 ? 0 : surface.warmth < -0.2 ? 2 : 1
  return {
    at,
    beasts: FEWEST_BEASTS + Math.floor(roll(4) * (MOST_BEASTS - FEWEST_BEASTS + 1)),
    kind,
    seed: roll(5),
  }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
