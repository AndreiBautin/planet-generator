import { hashed } from './birds'
import type { Vec3 } from './cube'
import { CELL_ANGLE, cellCentre, hydrologyOf, neighboursOf } from './hydrology'
import { surfaceAt, type Planet } from './planet'
import { settlementsOf } from './settlements'

/**
 * Where a world's ruins stand: the stones of whoever lived here before, on
 * a hilltop — a drainage cell higher than every cell round it — well away
 * from the towns that live here now, on dry ground under no snow. Rare,
 * decided by the cell and the seed alone so a ruin is always on the same
 * hill. Two kinds: a ring of columns, a temple roofless for a long time;
 * and the broken walls of a fort.
 *
 * On a lived-on world only: the ruins are of the people whose towns these
 * are, and a world with no towns had nobody to leave any.
 */
export interface Ruin {
  /** Its middle, a unit direction. */
  readonly at: Vec3
  /** 0 a ring of columns, 1 broken walls. */
  readonly kind: number
  /** 0 to 1: everything else — how many stones stand, which way it faces. */
  readonly seed: number
}

/** Nearer a living town than this, in radians, and its stones were carted off to build it. */
const CLEAR_OF_TOWNS = 0.03
/** How often a hilltop that qualifies has a ruin on it. */
const CHANCE = 0.35

export function ruinIn(planet: Planet, cell: number): Ruin | undefined {
  if (planet.molten || (planet.kind !== 'temperate' && planet.kind !== 'oceanic')) return undefined
  const water = hydrologyOf(planet)
  const here = water.height[cell] ?? 0
  if (here <= 0.02) return undefined
  // A hilltop: higher than every cell round it.
  if (neighboursOf(cell).some((next) => (water.height[next] ?? 0) >= here)) return undefined
  const roll = hashed(`${planet.seed}~ruin`, cell)
  if (roll(0) >= CHANCE) return undefined
  const centre = cellCentre(cell)
  const at = unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.3,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.3,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.3,
  ])
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.height <= 0 || surface.biome === 'snow' || surface.biome === 'sea-ice')
    return undefined
  for (const town of settlementsOf(planet).towns) {
    const dot = town.at[0] * at[0] + town.at[1] * at[1] + town.at[2] * at[2]
    if (Math.acos(Math.min(1, dot)) < CLEAR_OF_TOWNS) return undefined
  }
  return { at, kind: roll(4) < 0.55 ? 0 : 1, seed: roll(5) }
}

/** Every ruin on a world, found in the build worker with the lights and harbours. */
export function ruinsOf(planet: Planet): Ruin[] {
  const found: Ruin[] = []
  const cells = hydrologyOf(planet).height.length
  for (let cell = 0; cell < cells; cell += 1) {
    const ruin = ruinIn(planet, cell)
    if (ruin !== undefined) found.push(ruin)
  }
  return found
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
