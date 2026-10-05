import type { Rng } from './rng'

/**
 * Seeded 3D simplex noise.
 *
 * Simplex rather than Perlin because it samples a sphere without the axis
 * artefacts Perlin's grid leaves, and 3D rather than 2D because the planet
 * is sampled at points on a sphere: 3D noise has no seam and no pole
 * pinching, where 2D noise wrapped over a sphere has both.
 *
 * The permutation table is shuffled by the planet's own `Rng`, so a seed
 * fully determines the noise — no shared global table, no `Math.random`.
 * Output is in roughly [-1, 1].
 */
export type Noise3 = (x: number, y: number, z: number) => number

const GRADIENTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
]

const F3 = 1 / 3
const G3 = 1 / 6

export function createNoise3(rng: Rng): Noise3 {
  const base = Array.from({ length: 256 }, (_, at) => at)
  // Fisher–Yates with the planet's generator.
  for (let at = base.length - 1; at > 0; at -= 1) {
    const swap = rng.int(0, at)
    const held = base[at] ?? 0
    base[at] = base[swap] ?? 0
    base[swap] = held
  }
  const perm = new Uint8Array(512)
  const grad = new Uint8Array(512)
  for (let at = 0; at < 512; at += 1) {
    const value = base[at & 255] ?? 0
    perm[at] = value
    grad[at] = value % 12
  }

  const corner = (gi: number, x: number, y: number, z: number): number => {
    const t = 0.6 - x * x - y * y - z * z
    if (t < 0) return 0
    const g = GRADIENTS[gi] ?? [0, 0, 0]
    const t2 = t * t
    return t2 * t2 * (g[0] * x + g[1] * y + g[2] * z)
  }

  return (xin, yin, zin) => {
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const z0 = zin - (k - t)

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0]
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1]
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1]
    } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1]
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1]
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0]

    const x1 = x0 - i1 + G3
    const y1 = y0 - j1 + G3
    const z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3
    const y2 = y0 - j2 + 2 * G3
    const z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3
    const y3 = y0 - 1 + 3 * G3
    const z3 = z0 - 1 + 3 * G3

    const ii = i & 255
    const jj = j & 255
    const kk = k & 255
    const p = (at: number) => perm[at] ?? 0
    const g = (at: number) => grad[at] ?? 0
    const g0 = g(ii + p(jj + p(kk)))
    const g1 = g(ii + i1 + p(jj + j1 + p(kk + k1)))
    const g2 = g(ii + i2 + p(jj + j2 + p(kk + k2)))
    const g3 = g(ii + 1 + p(jj + 1 + p(kk + 1)))

    return (
      32 *
      (corner(g0, x0, y0, z0) +
        corner(g1, x1, y1, z1) +
        corner(g2, x2, y2, z2) +
        corner(g3, x3, y3, z3))
    )
  }
}

/**
 * Fractal noise: several octaves of the same noise at rising frequency and
 * falling amplitude, normalised back to roughly [-1, 1]. Large shapes from
 * the first octave, detail from the rest.
 */
export function fbm(
  noise: Noise3,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let total = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * noise(x * frequency, y * frequency, z * frequency)
    total += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / total
}

/**
 * Ridged noise for mountain chains: folding the noise at zero turns smooth
 * hills into sharp crests. In [0, 1], peaking along the ridges.
 */
export function ridged(noise: Noise3, x: number, y: number, z: number, octaves: number): number {
  let sum = 0
  let amplitude = 0.5
  let frequency = 1
  let total = 0
  let weight = 1
  for (let octave = 0; octave < octaves; octave += 1) {
    let value = 1 - Math.abs(noise(x * frequency, y * frequency, z * frequency))
    value *= value * weight
    weight = Math.min(1, Math.max(0, value * 2))
    sum += value * amplitude
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return sum / total
}
