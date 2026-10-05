import { fbm } from './noise'
import type { Planet } from './planet'

/**
 * How the things on the ground group, as three noise fields read at a
 * point: groves (broad, with clearings between), outcrops (tighter, sharper
 * edged) and pavements (patches of cooled lava that are all columns or
 * none). The scatterer thins or thickens each kind of feature by these,
 * and the ground is painted by the same fields — the floor of a wood is
 * dark exactly where the trees are thick, the ground stony exactly where
 * the rocks lie — so what stands on the ground and the ground under it
 * cannot disagree about where a grove or an outcrop is.
 *
 * On the fine fork, like everything the renderer adds: the pinned surface
 * is untouched.
 */
export interface Groupings {
  /** 0 clearing to 1 thicket. */
  readonly grove: number
  /** 0 clear ground to 1 outcrop. */
  readonly outcrop: number
  /** Raw, around −1 to 1: the pavement rule reads it with a threshold. */
  readonly pavement: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const smooth = (from: number, to: number, value: number): number => {
  const t = clamp01((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}

export function groupingsAt(planet: Planet, x: number, y: number, z: number): Groupings {
  const [ox, oy, oz] = planet.offset
  // A wood is a stand, not a sprinkle: a broad field decides where the
  // woods are and a finer one roughens their edges, then a sharp step
  // makes the inside solid and the outside bare. A soft ramp here gave
  // every acre a thin scattering of trees, which read as random.
  const stand =
    fbm(planet.fine, (x + oy) * 24, (y + oz) * 24, (z + ox) * 24, 3) +
    fbm(planet.fine, (x - oz) * 140, (y + ox) * 140, (z - oy) * 140, 2) * 0.3
  const inside = smooth(-0.03, 0.06, stand)
  // A ragged margin of single trees just outside the stand, and a little
  // thinning inside it so the canopy is not one even sheet.
  const margin = smooth(-0.16, -0.03, stand) * (1 - inside) * 0.14
  const thinning = 0.82 + fbm(planet.fine, (x + ox) * 300, (y + oy) * 300, (z + oz) * 300, 2) * 0.35
  // Rock the same way: it lies in outcrops and scree, with bare ground
  // between, not as an even rubble over every slope.
  const rocky = fbm(planet.fine, (x - oy) * 190, (y - oz) * 190, (z + ox) * 190, 2)
  const outcrop = Math.max(smooth(0.06, 0.16, rocky), smooth(-0.04, 0.06, rocky) * 0.12)
  const pavement = fbm(planet.fine, (x + oz) * 110, (y - ox) * 110, (z + oy) * 110, 2)
  return {
    grove: Math.max(inside * clamp01(thinning), margin),
    outcrop,
    pavement: rocky > -0.3 && pavement > 0.1 ? 1 : 0,
  }
}
