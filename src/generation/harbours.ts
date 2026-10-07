import type { Vec3 } from './cube'
import { surfaceAt, type Planet } from './planet'
import { settlementsOf, type Town } from './settlements'

/**
 * Harbours and the sea lanes between them, on a lived-on world.
 *
 * A harbour is a coastal town's: the nearest shore to its heart, within a
 * little of its houses' reach, with a pier running out from it to sea. A
 * lane joins two harbours when the straight way between their mouths is
 * open water all along it; a harbour with no lane keeps a loop of its own
 * offshore, so every harbour has ships. Ships sail them (render/ships.ts).
 */
export interface Harbour {
  /** Where the pier leaves the land, a unit direction on the shore. */
  readonly shore: Vec3
  /** Which way is out to sea from there, a unit vector along the ground. */
  readonly out: Vec3
  /** Where ships come and go, out past the pier: a unit direction over open water. */
  readonly mouth: Vec3
  /** The town's size, 0 to 1. */
  readonly size: number
}

export interface Harbours {
  readonly harbours: readonly Harbour[]
  /** Each lane as the points a ship sails through, a closed loop: out along it and back. */
  readonly lanes: readonly (readonly Vec3[])[]
}

/** How far out from the shore a harbour's mouth is, in radians. */
const MOUTH = 0.003
/** The furthest apart two harbours can be and still share a lane. */
const LANE_REACH = 0.2

const made = new WeakMap<Planet, Harbours>()

export function harboursOf(planet: Planet): Harbours {
  const known = made.get(planet)
  if (known !== undefined) return known
  const sea = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height < 0
  const harbours: Harbour[] = []
  for (const town of settlementsOf(planet).towns) {
    const harbour = harbourFor(town, sea)
    if (harbour !== undefined) harbours.push(harbour)
  }
  const lanes: Vec3[][] = []
  const laned = new Set<number>()
  harbours.forEach((a, i) => {
    harbours.forEach((b, j) => {
      if (j <= i) return
      const apart = angle(a.mouth, b.mouth)
      if (apart > LANE_REACH || apart < 0.01) return
      const steps = Math.max(8, Math.ceil(apart / 0.004))
      const way: Vec3[] = []
      for (let s = 0; s <= steps; s += 1) way.push(slerp(a.mouth, b.mouth, s / steps))
      if (!way.every(sea)) return
      // Out along the lane and back: a closed loop the ships go round.
      lanes.push([...way, ...way.slice(1, -1).reverse()])
      laned.add(i)
      laned.add(j)
    })
  })
  // A harbour with no lane keeps a loop offshore, if the water is open there.
  harbours.forEach((harbour, i) => {
    if (laned.has(i)) return
    const centre = along(harbour.mouth, harbour.out, 0.006)
    const loop: Vec3[] = []
    for (let k = 0; k < 16; k += 1) {
      const turn = (k / 16) * Math.PI * 2
      loop.push(around(centre, 0.0045, turn))
    }
    if (loop.every(sea)) lanes.push(loop)
  })
  const result = { harbours, lanes }
  made.set(planet, result)
  return result
}

/** A coastal town's harbour: the nearest shore to its heart, if one is near. */
function harbourFor(town: Town, sea: (d: Vec3) => boolean): Harbour | undefined {
  const reach = 0.004 + town.size * 0.012
  let best: { shore: Vec3; out: Vec3; r: number } | undefined
  for (let k = 0; k < 24; k += 1) {
    const bearing = (k / 24) * Math.PI * 2
    let last = town.at
    for (let r = 0.0005; r <= reach; r += 0.0005) {
      const here = around(town.at, r, bearing)
      if (sea(here)) {
        if (best === undefined || r < best.r) best = { shore: last, out: tangent(last, here), r }
        break
      }
      last = here
    }
  }
  if (best === undefined) return undefined
  const mouth = along(best.shore, best.out, MOUTH)
  // A shore on a lake or a narrow inlet is no harbour: the mouth must be open sea.
  if (!sea(mouth) || !sea(along(best.shore, best.out, MOUTH * 2))) return undefined
  return { shore: best.shore, out: best.out, mouth, size: town.size }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

/** The unit vector along the ground at `from` pointing towards `to`. */
function tangent(from: Vec3, to: Vec3): Vec3 {
  const d = dot(from, to)
  return unit([to[0] - from[0] * d, to[1] - from[1] * d, to[2] - from[2] * d])
}

/** Go `distance` radians from `from` along the ground in direction `heading`. */
function along(from: Vec3, heading: Vec3, distance: number): Vec3 {
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  return unit([
    from[0] * c + heading[0] * s,
    from[1] * c + heading[1] * s,
    from[2] * c + heading[2] * s,
  ])
}

/** A point `distance` radians from `centre`, at `bearing` round it. */
function around(centre: Vec3, distance: number, bearing: number): Vec3 {
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
  const heading: Vec3 = [
    e1[0] * Math.cos(bearing) + e2[0] * Math.sin(bearing),
    e1[1] * Math.cos(bearing) + e2[1] * Math.sin(bearing),
    e1[2] * Math.cos(bearing) + e2[2] * Math.sin(bearing),
  ]
  return along(centre, heading, distance)
}

/** Between two unit directions, `t` of the way along the great circle. */
function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const omega = angle(a, b)
  if (omega < 1e-9) return a
  const s = Math.sin(omega)
  const wa = Math.sin((1 - t) * omega) / s
  const wb = Math.sin(t * omega) / s
  return unit([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb])
}
