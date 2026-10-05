import { cloudDensityAt } from '@/generation/clouds'
import type { Planet } from '@/generation/planet'

/**
 * The slow, shared parts of drawing a planet that are not patches: how far
 * a height lifts the ground, and the cloud texture. Plain numbers and typed
 * arrays, so they run in a worker and cross back without a copy.
 */

/** How far above the sea's surface the lowest land sits. */
const LAND_CLEARANCE = 0.003

/**
 * The radius a surface height is drawn at, above 1. Land rises with the
 * relief, starting just clear of the water so the coast does not flicker
 * where the two surfaces meet; the sea floor sinks more gently, so the
 * water over it is shallow at the coast.
 */
export function liftOf(height: number, relief: number): number {
  return height > 0 ? LAND_CLEARANCE + height * relief * 0.7 : height * relief * 0.35
}

/**
 * Cloud opacity as a texture the width given and half as tall, one byte a
 * texel (RGBA, so it uploads everywhere). Laid out as Three's sphere maps
 * it: v = 1 at the north pole, and a data texture's first row is v = 0, so
 * the rows run south to north.
 */
export function bakeClouds(planet: Planet, width: number): Uint8Array {
  const height = width / 2
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const theta = (1 - (row + 0.5) / height) * Math.PI
    const ring = Math.sin(theta)
    const y = Math.cos(theta)
    for (let column = 0; column < width; column += 1) {
      const phi = ((column + 0.5) / width) * Math.PI * 2
      const density = cloudDensityAt(planet, -Math.cos(phi) * ring, y, Math.sin(phi) * ring)
      const at = (row * width + column) * 4
      const value = Math.round(density * 255)
      data[at] = value
      data[at + 1] = value
      data[at + 2] = value
      data[at + 3] = 255
    }
  }
  return data
}
