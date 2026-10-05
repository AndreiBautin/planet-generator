import type { Rng } from './rng'

/**
 * The sky behind a planet: points scattered evenly over a distant sphere,
 * most of them faint and a few bright, some warm and some cool. Drawn from
 * the seed's own `stars` fork, so a planet keeps its sky and adding stars
 * never moves the terrain.
 */
export interface StarField {
  /** x, y, z per star, on a sphere of the given radius. */
  readonly positions: Float32Array
  /** r, g, b per star, already scaled by its brightness. */
  readonly colours: Float32Array
}

export function starField(rng: Rng, count: number, radius: number): StarField {
  const positions = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  for (let at = 0; at < count; at += 1) {
    // Uniform on a sphere: z uniform in [-1, 1] and the angle around it
    // uniform. Picking two angles uniformly bunches the stars at the poles.
    const z = rng.range(-1, 1)
    const angle = rng.range(0, Math.PI * 2)
    const ring = Math.sqrt(1 - z * z)
    positions[at * 3] = Math.cos(angle) * ring * radius
    positions[at * 3 + 1] = Math.sin(angle) * ring * radius
    positions[at * 3 + 2] = z * radius
    // Most stars are faint; cubing a uniform draw leaves a handful bright.
    const brightness = 0.15 + rng.next() ** 3 * 0.85
    // A tint from warm to cool, kept pale so the sky reads as white.
    const tint = rng.range(-1, 1)
    colours[at * 3] = brightness * (1 + Math.max(0, tint) * 0.15)
    colours[at * 3 + 1] = brightness
    colours[at * 3 + 2] = brightness * (1 + Math.max(0, -tint) * 0.25)
  }
  return { positions, colours }
}
