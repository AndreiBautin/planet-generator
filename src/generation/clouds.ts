import { fbm } from './noise'
import type { Planet } from './planet'

/**
 * How cloudy the sky is in a direction, 0 (clear) to 1 (solid), from the
 * planet's own `clouds` noise.
 *
 * Stretched along the spin axis's equator, so clouds lie in bands the way
 * weather does on a turning world rather than as round blobs, and thresholded
 * by the kind's cover so a desert sky is mostly clear and an ocean world's
 * mostly not. The soft edge is what keeps them from reading as paper cutouts.
 */
export function cloudDensityAt(planet: Planet, x: number, y: number, z: number): number {
  const length = Math.hypot(x, y, z) || 1
  const ux = x / length
  const uy = y / length
  const uz = z / length
  const [ox, oy, oz] = planet.offset
  const raw = fbm(planet.clouds, (ux + oy) * 3.2, (uy - oz) * 7, (uz + ox) * 3.2, 6) * 0.5 + 0.5
  // Cover 0.5 puts the threshold at the noise's middle; more cover lowers it.
  const threshold = 0.82 - planet.cloudCover * 0.56
  const soft = 0.22
  return Math.min(1, Math.max(0, (raw - threshold) / soft))
}
