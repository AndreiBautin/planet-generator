import { fbm } from './noise'
import type { Planet } from './planet'

/**
 * How cloudy the sky is in a direction, 0 (clear) to 1 (solid), from the
 * planet's own `clouds` noise.
 *
 * Stretched along the spin axis's equator, so clouds lie in bands the way
 * weather does on a turning world rather than as round blobs, and thresholded
 * by the kind's cover, and warped by a broad copy of itself into fronts, so a desert sky is mostly clear and an ocean world's
 * mostly not. The soft edge is what keeps them from reading as paper cutouts.
 */
export function cloudDensityAt(planet: Planet, x: number, y: number, z: number): number {
  const length = Math.hypot(x, y, z) || 1
  const ux = x / length
  const uy = y / length
  const uz = z / length
  const [ox, oy, oz] = planet.offset
  // Read through a broad warp of the same noise, so the cover runs in
  // fronts and swirls rather than as a field of round heaps all one size.
  const wx = fbm(planet.clouds, ux * 1.6 + 17.3, uy * 1.6, uz * 1.6, 3)
  const wy = fbm(planet.clouds, ux * 1.6, uy * 1.6 - 9.1, uz * 1.6 + 4.7, 3)
  const sx = ux + oy + wx * 0.42
  const sy = uy - oz + wy * 0.16
  const sz = uz + ox - wx * 0.3
  const raw = fbm(planet.clouds, sx * 3.2, sy * 7, sz * 3.2, 5) * 0.5 + 0.5
  // Cover 0.5 puts the threshold at the noise's middle; more cover lowers it.
  const threshold = 0.82 - planet.cloudCover * 0.56
  const soft = 0.3
  return Math.min(1, Math.max(0, (raw - threshold) / soft))
}
