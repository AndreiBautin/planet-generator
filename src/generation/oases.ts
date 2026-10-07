import { hashed } from './birds'
import type { Vec3 } from './cube'
import { featuresAt } from './features'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Life in the deserts: oases — a pool ringed with green and palms — and
 * caravans of camels plodding across the sand. At most one of each to a
 * cell of the drainage map, decided by the cell and the seed alone on rolls
 * of their own, and only where the ground is desert (`featuresAt`'s cactus,
 * which is its share of desert scaled down).
 */
export interface Oasis {
  /** Its pool's middle, a unit direction. */
  readonly at: Vec3
  /** The pool's radius, in radians. */
  readonly pool: number
  readonly palms: number
  readonly seed: number
}

export interface Caravan {
  /** Where its walk starts and ends, unit directions: it goes there and back. */
  readonly from: Vec3
  readonly to: Vec3
  readonly camels: number
  readonly seed: number
}

/** How much of a place is desert, 0 to 1. */
export function desertAt(planet: Planet, at: Vec3): number {
  const surface = surfaceAt(planet, at[0], at[1], at[2])
  if (surface.height <= 0.01 || planet.molten) return 0
  // `featuresAt` gives cacti at an eighth of the desert share.
  return Math.min(1, featuresAt(planet, surface, 0).cactus / 0.12)
}

export function oasisIn(planet: Planet, cell: number): Oasis | undefined {
  const roll = hashed(`${planet.seed}~oasis`, cell)
  if (roll(0) >= 0.14) return undefined
  const at = near(cell, roll)
  if (desertAt(planet, at) < 0.6) return undefined
  return {
    at,
    pool: 0.00035 + roll(4) * 0.0004,
    palms: 6 + Math.floor(roll(5) * 10),
    seed: roll(6),
  }
}

export function caravanIn(planet: Planet, cell: number): Caravan | undefined {
  const roll = hashed(`${planet.seed}~caravan`, cell)
  if (roll(0) >= 0.2) return undefined
  const from = near(cell, roll)
  const bearing = roll(4) * Math.PI * 2
  const to = around(from, 0.006 + roll(5) * 0.006, bearing)
  // Desert all the way: a caravan does not wade into the sea or a wood.
  for (let t = 0; t <= 1; t += 0.25) {
    const p = unit([
      from[0] * (1 - t) + to[0] * t,
      from[1] * (1 - t) + to[1] * t,
      from[2] * (1 - t) + to[2] * t,
    ])
    if (desertAt(planet, p) < 0.5) return undefined
  }
  return { from, to, camels: 4 + Math.floor(roll(6) * 5), seed: roll(7) }
}

function near(cell: number, roll: (slot: number) => number): Vec3 {
  const centre = cellCentre(cell)
  return unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.6,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.6,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.6,
  ])
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** A point `distance` radians from `centre`, at `bearing` round it. */
export function around(centre: Vec3, distance: number, bearing: number): Vec3 {
  const helper: Vec3 = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit([
    helper[1] * centre[2] - helper[2] * centre[1],
    helper[2] * centre[0] - helper[0] * centre[2],
    helper[0] * centre[1] - helper[1] * centre[0],
  ])
  const e2: Vec3 = [
    centre[1] * e1[2] - centre[2] * e1[1],
    centre[2] * e1[0] - centre[0] * e1[2],
    centre[0] * e1[1] - centre[1] * e1[0],
  ]
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  const cb = Math.cos(bearing)
  const sb = Math.sin(bearing)
  return unit([
    centre[0] * c + (e1[0] * cb + e2[0] * sb) * s,
    centre[1] * c + (e1[1] * cb + e2[1] * sb) * s,
    centre[2] * c + (e1[2] * cb + e2[2] * sb) * s,
  ])
}
