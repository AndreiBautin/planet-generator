import { hashed } from './birds'
import type { Vec3 } from './cube'
import { CELL_ANGLE, cellCentre } from './hydrology'
import { surfaceAt, type Planet } from './planet'

/**
 * Rocky coasts: where high ground meets the sea, the sea has cut it back and
 * left stacks of rock standing off the shore — a few pillars, sometimes one
 * pierced right through as an arch. At most a group to a cell of the
 * drainage map, decided by the cell and the seed alone, on rolls of their
 * own, so the same headland always has the same stacks.
 *
 * Found by sampling the surface rather than the drainage map, so it runs on
 * the page as the birds and fish do: a point near the cell's middle on land
 * that stands high, and open water within a short way of it.
 */
export interface Stack {
  /** Where it stands, a unit direction over the water. */
  readonly at: Vec3
  /** How high it stands over the sea, and how wide it is at the water, in radii. */
  readonly height: number
  readonly radius: number
}

export interface Rocks {
  /** Where the shore is, a unit direction on the land at the water's edge. */
  readonly shore: Vec3
  /** Which way is out to sea from there, a unit vector along the ground. */
  readonly out: Vec3
  readonly stacks: readonly Stack[]
  /** An arch, if there is one: its two feet, and how high its crown stands. */
  readonly arch: { readonly from: Vec3; readonly to: Vec3; readonly height: number } | undefined
  /** 0 to 1: everything else. */
  readonly seed: number
}

/** Land at least this high near the water makes a rocky coast. */
const HIGH = 0.022
/** How far out stacks stand, in radians from the shore. */
const NEAREST = 0.0006
const FURTHEST = 0.0026

export function rocksIn(planet: Planet, cell: number): Rocks | undefined {
  if (planet.molten) return undefined
  const roll = hashed(`${planet.seed}~rocks`, cell)
  if (roll(0) >= 0.45) return undefined
  const centre = cellCentre(cell)
  const land = unit([
    centre[0] + (roll(1) - 0.5) * CELL_ANGLE * 0.5,
    centre[1] + (roll(2) - 0.5) * CELL_ANGLE * 0.5,
    centre[2] + (roll(3) - 0.5) * CELL_ANGLE * 0.5,
  ])
  const sea = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height < 0
  if (sea(land) || surfaceAt(planet, land[0], land[1], land[2]).height < HIGH) return undefined
  // The nearest water, looking round: the first bearing to find it within
  // a short way is the sea face of this high ground.
  let best: { shore: Vec3; out: Vec3; r: number } | undefined
  for (let k = 0; k < 12; k += 1) {
    const bearing = (k / 12) * Math.PI * 2 + roll(4)
    let last = land
    for (let r = 0.0005; r <= 0.008; r += 0.0005) {
      const here = around(land, r, bearing)
      if (sea(here)) {
        if (best === undefined || r < best.r) best = { shore: last, out: tangent(last, here), r }
        break
      }
      last = here
    }
  }
  if (best === undefined) return undefined
  const { shore, out } = best
  const side = unit(cross(shore, out))
  const stacks: Stack[] = []
  const count = 1 + Math.floor(roll(5) * 4)
  for (let k = 0; k < count; k += 1) {
    const away = NEAREST + roll(10 + k) * (FURTHEST - NEAREST)
    const along = (roll(20 + k) - 0.5) * 0.004
    const at = step(step(shore, out, away), side, along)
    // Over water, and not out past the shelf: a stack stands in the shallows.
    const under = surfaceAt(planet, at[0], at[1], at[2]).height
    if (under >= 0 || under < -0.03) continue
    stacks.push({
      at,
      // Squat and broad: as tall thin posts they read as a pier's piles. And
      // tall enough to clear the water as it is drawn along a shore, which
      // stands well over the sea's own level there: at a thousandth, the
      // swell swallowed all but their tops.
      height: (0.0016 + roll(30 + k) * 0.0016) * (1 - away / (FURTHEST * 1.6)),
      radius: 0.0003 + roll(40 + k) * 0.00035,
    })
  }
  // Now and then an arch: two feet in the water a little apart, joined over.
  let arch: Rocks['arch']
  if (roll(6) < 0.3) {
    const middle = step(shore, out, NEAREST + 0.0004)
    const from = step(middle, side, -0.0004)
    const to = step(middle, side, 0.0004)
    const wet = (d: Vec3): boolean => {
      const h = surfaceAt(planet, d[0], d[1], d[2]).height
      return h < 0 && h > -0.03
    }
    if (wet(from) && wet(to)) arch = { from, to, height: 0.0019 + roll(7) * 0.0008 }
  }
  if (stacks.length === 0 && arch === undefined) return undefined
  return { shore, out, stacks, arch, seed: roll(8) }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The unit vector along the ground at `from` pointing towards `to`. */
function tangent(from: Vec3, to: Vec3): Vec3 {
  const d = dot(from, to)
  return unit([to[0] - from[0] * d, to[1] - from[1] * d, to[2] - from[2] * d])
}

/** Go `distance` radians from `from` along the ground in direction `heading` (a tangent there, or near enough). */
function step(from: Vec3, heading: Vec3, distance: number): Vec3 {
  const h = tangent(
    from,
    unit([from[0] + heading[0] * 1e-3, from[1] + heading[1] * 1e-3, from[2] + heading[2] * 1e-3]),
  )
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  return unit([from[0] * c + h[0] * s, from[1] * c + h[1] * s, from[2] * c + h[2] * s])
}

/** A point `distance` radians from `centre`, at `bearing` round it. */
function around(centre: Vec3, distance: number, bearing: number): Vec3 {
  const helper: Vec3 = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit(cross(helper, centre))
  const e2 = cross(centre, e1)
  const heading: Vec3 = [
    e1[0] * Math.cos(bearing) + e2[0] * Math.sin(bearing),
    e1[1] * Math.cos(bearing) + e2[1] * Math.sin(bearing),
    e1[2] * Math.cos(bearing) + e2[2] * Math.sin(bearing),
  ]
  return step(centre, heading, distance)
}
