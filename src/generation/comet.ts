import type { Vec3 } from './cube'
import { createRng } from './rng'
import type { Seed } from './seed'

/**
 * A great comet hanging in some worlds' skies: a bright head a few tens of
 * degrees from the sun, so it shows in the dusk and dawn and on through the
 * night, and a tail streaming straight away from the sun as a comet's does
 * — not behind it along its path. Decided by the seed alone; where it stands
 * among the stars follows the sun as the seasons move it.
 */
export interface Comet {
  /** How far from the sun the head stands, in radians. */
  readonly elongation: number
  /** Which way round the sun, in radians. */
  readonly round: number
  /** The tail's length across the sky, in radians. */
  readonly length: number
  /** How far the broad dust tail curls off the straight line, -1 to 1. */
  readonly curl: number
}

/** About one world in three has a comet in its sky. */
const CHANCE = 0.35

export function cometOf(seed: Seed): Comet | undefined {
  const rng = createRng(seed).fork('comet')
  if (rng.next() >= CHANCE) return undefined
  return {
    elongation: rng.range(0.55, 1.2),
    round: rng.range(0, Math.PI * 2),
    length: rng.range(0.26, 0.5),
    curl: rng.range(-1, 1),
  }
}

/** Where the comet stands with the sun at `sun`: its head, and the way its tail runs from it across the sky. */
export function cometInSky(comet: Comet, sun: Vec3): { head: Vec3; tail: Vec3 } {
  const s = unit(sun)
  // Two directions square to the sun, to turn the head round it by.
  const helper: Vec3 = Math.abs(s[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit(cross(helper, s))
  const e2 = cross(s, e1)
  const c = Math.cos(comet.elongation)
  const n = Math.sin(comet.elongation)
  const cr = Math.cos(comet.round)
  const sr = Math.sin(comet.round)
  const head = unit([
    s[0] * c + (e1[0] * cr + e2[0] * sr) * n,
    s[1] * c + (e1[1] * cr + e2[1] * sr) * n,
    s[2] * c + (e1[2] * cr + e2[2] * sr) * n,
  ])
  // Away from the sun along the sky: the anti-sun direction, less the part
  // of it that points at the head.
  const away: Vec3 = [-s[0], -s[1], -s[2]]
  const along = dot(away, head)
  const tail = unit([
    away[0] - head[0] * along,
    away[1] - head[1] * along,
    away[2] - head[2] * along,
  ])
  return { head, tail }
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
