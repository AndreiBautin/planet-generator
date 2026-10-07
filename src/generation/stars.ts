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

/**
 * The galaxy's band across the sky: a great circle, its plane chosen by
 * the seed, thick with faint stars — scattered either side of it as a
 * bell, so the band has a bright spine and frayed edges — and clumped
 * along it in a few brighter clouds, as the Milky Way is. `normal` is the
 * band's plane, as the unit vector square to it.
 */
export function galaxyBand(
  rng: Rng,
  count: number,
  radius: number,
): StarField & { readonly normal: readonly [number, number, number] } {
  const z = rng.range(-1, 1)
  const turn = rng.range(0, Math.PI * 2)
  const ring = Math.sqrt(1 - z * z)
  const normal: [number, number, number] = [Math.cos(turn) * ring, Math.sin(turn) * ring, z]
  // Two directions in the band's plane.
  const helper: [number, number, number] = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a = unit(cross(normal, helper))
  const b = cross(normal, a)
  // A few bright clouds along the band, where its stars crowd.
  const clouds = Array.from({ length: 5 }, () => rng.range(0, Math.PI * 2))
  const positions = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  for (let at = 0; at < count; at += 1) {
    // Along the band, drawn towards a cloud half the time.
    let around = rng.range(0, Math.PI * 2)
    if (rng.next() < 0.5)
      around =
        (clouds[Math.floor(rng.next() * clouds.length)] ?? 0) + (rng.next() + rng.next() - 1) * 0.5
    // Off it, as a bell: the sum of three draws.
    const off = (rng.next() + rng.next() + rng.next() - 1.5) * 0.16
    const c = Math.cos(off)
    for (let k = 0; k < 3; k += 1) {
      const along = (a[k] ?? 0) * Math.cos(around) + (b[k] ?? 0) * Math.sin(around)
      positions[at * 3 + k] = (along * c + (normal[k] ?? 0) * Math.sin(off)) * radius
    }
    // Faint, and a little warm: the galaxy's light is old stars.
    const brightness = 0.08 + rng.next() ** 4 * 0.45
    colours[at * 3] = brightness * 1.05
    colours[at * 3 + 1] = brightness
    colours[at * 3 + 2] = brightness * 0.95
  }
  return { positions, colours, normal }
}

type V3 = readonly [number, number, number]
const cross = (p: V3, q: V3): [number, number, number] => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
]
const unit = (v: V3): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
