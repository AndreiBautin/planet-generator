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

export function groupingsAt(planet: Planet, x: number, y: number, z: number): Groupings {
  const [ox, oy, oz] = planet.offset
  const grove =
    fbm(planet.fine, (x + oy) * 70, (y + oz) * 70, (z + ox) * 70, 3) * 0.6 +
    fbm(planet.fine, (x - oz) * 320, (y + ox) * 320, (z - oy) * 320, 2) * 0.4
  const outcrop = fbm(planet.fine, (x - oy) * 190, (y - oz) * 190, (z + ox) * 190, 2)
  const pavement = fbm(planet.fine, (x + oz) * 110, (y - ox) * 110, (z + oy) * 110, 2)
  return {
    grove: clamp01((grove + 0.32) / 0.5),
    outcrop: clamp01((outcrop + 0.05) / 0.3),
    pavement: outcrop > -0.3 && pavement > 0.1 ? 1 : 0,
  }
}
