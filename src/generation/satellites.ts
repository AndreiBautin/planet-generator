import { createNoise3, fbm } from './noise'
import type { Planet } from './planet'
import { createRng } from './rng'

/**
 * What else is in a planet's sky: its moons and its rings, decided by the
 * seed alone, so a shared link shares them too.
 *
 * Pure numbers, like everything in generation: where each moon orbits and
 * how big it is, how the rings are banded. Drawing them is render's.
 *
 * Distances are in planet radii from the planet's centre. The moons are
 * far larger and nearer than a real planet's would be for their size —
 * on purpose: a moon a degree across from the ground is a dot, and these
 * are there to be looked at.
 */
export interface Moon {
  /** Its radius, as a share of the planet's. */
  readonly radius: number
  /** Distance from the planet's centre. */
  readonly distance: number
  /** Tilt of its orbit from the planet's equator, radians. */
  readonly inclination: number
  /** Where its orbit crosses the equator going north, radians round. */
  readonly node: number
  /** Seconds to go round once. */
  readonly period: number
  /** Where it is at time nought, radians round its orbit. */
  readonly phase: number
  /** Its colour, linear 0 to 1: grey rock, tinted a little. */
  readonly tint: readonly [number, number, number]
  /** Its surface: a value 0 to 1 a texel, `MOON_MAP_WIDTH` wide and half as tall, laid out as a sphere's map. */
  readonly surface: Float32Array
}

export interface Rings {
  /** Inner and outer edge, in planet radii. They lie in the equatorial plane. */
  readonly inner: number
  readonly outer: number
  /** Their colour, linear 0 to 1. */
  readonly tint: readonly [number, number, number]
  /** How solid the rings are from the inner edge to the outer, `RING_BANDS` samples, 0 to 1. */
  readonly bands: Float32Array
}

export interface Satellites {
  readonly moons: readonly Moon[]
  readonly rings: Rings | undefined
}

export const MOON_MAP_WIDTH = 128
export const RING_BANDS = 256

/** Nearest a moon may orbit: clear of the rings' widest reach. */
const NEAREST_MOON = 4.2

export function satellitesOf(planet: Planet): Satellites {
  const rng = createRng(planet.seed).fork('satellites')
  // Most worlds have a moon, some two, a few none.
  const roll = rng.next()
  const count = roll < 0.2 ? 0 : roll < 0.75 ? 1 : 2
  const moons: Moon[] = []
  for (let k = 0; k < count; k += 1) {
    const own = rng.fork(`moon-${String(k)}`)
    // The second moon further out than the first, so they never share an orbit.
    const distance = NEAREST_MOON + k * 3.2 + own.range(0, 2.4)
    const radius = own.range(0.12, 0.3) * (k === 0 ? 1 : 0.7)
    const shade = own.range(0.45, 0.75)
    const warm = own.range(-0.06, 0.08)
    moons.push({
      radius,
      distance,
      inclination: own.range(-0.25, 0.25),
      node: own.range(0, Math.PI * 2),
      // Further out, slower: periods of a few minutes, so a moon is seen to move.
      period: 150 * Math.pow(distance / NEAREST_MOON, 1.5) * own.range(0.9, 1.1),
      phase: own.range(0, Math.PI * 2),
      tint: [shade + warm, shade, shade - warm * 0.6],
      surface: moonSurface(own.fork('surface')),
    })
  }

  const ringed = rng.fork('rings')
  // Rings on about one world in four; never on a molten one, whose heat
  // would have long since cleared them.
  const rings =
    !planet.molten && ringed.next() < 0.27
      ? {
          inner: ringed.range(1.35, 1.7),
          outer: ringed.range(2.1, 2.9),
          tint: ringTint(ringed),
          bands: ringBands(ringed.fork('bands')),
        }
      : undefined
  return { moons, rings }
}

function ringTint(rng: ReturnType<typeof createRng>): readonly [number, number, number] {
  // Ice white, dusty tan, or rust: what rings are made of.
  const pick = rng.next()
  const base: readonly [number, number, number] =
    pick < 0.4 ? [0.82, 0.8, 0.76] : pick < 0.8 ? [0.72, 0.62, 0.48] : [0.66, 0.46, 0.34]
  const lift = rng.range(-0.06, 0.06)
  return [base[0] + lift, base[1] + lift, base[2] + lift]
}

/**
 * How solid the rings are across their width: fine ringlets on a broader
 * swell, a gap or two cut clean through, and a soft fade at each edge.
 */
function ringBands(rng: ReturnType<typeof createRng>): Float32Array {
  const noise = createNoise3(rng)
  const bands = new Float32Array(RING_BANDS)
  const gaps = [rng.range(0.25, 0.45), rng.range(0.6, 0.85)]
  const gapWidth = [rng.range(0.01, 0.04), rng.range(0.005, 0.02)]
  for (let i = 0; i < RING_BANDS; i += 1) {
    const t = i / (RING_BANDS - 1)
    const broad = fbm(noise, t * 4, 0.5, 0.5, 2) * 0.5 + 0.5
    const fine = fbm(noise, t * 60, 3.1, 1.7, 3) * 0.5 + 0.5
    let solid = 0.25 + broad * 0.5 + (fine - 0.5) * 0.5
    gaps.forEach((at, k) => {
      const width = gapWidth[k] ?? 0.01
      if (Math.abs(t - at) < width) solid *= 0.05
    })
    const edge = Math.min(1, t / 0.06, (1 - t) / 0.08)
    bands[i] = Math.min(1, Math.max(0, solid * edge))
  }
  return bands
}

/**
 * A moon's face: rolling grey highlands and darker seas, pocked with
 * craters — a raised rim, a darker floor — of every size, the small ones
 * many. Laid out as a sphere's map, with each crater placed in 3D so none
 * is stretched near a pole.
 */
function moonSurface(rng: ReturnType<typeof createRng>): Float32Array {
  const width = MOON_MAP_WIDTH
  const height = width / 2
  const noise = createNoise3(rng)
  const craters: { readonly at: readonly [number, number, number]; readonly size: number }[] = []
  for (let k = 0; k < 90; k += 1) {
    const z = rng.range(-1, 1)
    const a = rng.range(0, Math.PI * 2)
    const r = Math.sqrt(1 - z * z)
    // Many small, few large.
    const size = 0.04 + Math.pow(rng.next(), 3) * 0.28
    craters.push({ at: [r * Math.cos(a), z, r * Math.sin(a)], size })
  }
  const map = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI
    for (let x = 0; x < width; x += 1) {
      const lon = ((x + 0.5) / width) * Math.PI * 2
      const p: readonly [number, number, number] = [
        Math.cos(lat) * Math.cos(lon),
        Math.sin(lat),
        Math.cos(lat) * Math.sin(lon),
      ]
      const seas = fbm(noise, p[0] * 1.6, p[1] * 1.6, p[2] * 1.6, 3)
      let value =
        0.62 + (seas < -0.05 ? -0.18 : 0) + fbm(noise, p[0] * 9, p[1] * 9, p[2] * 9, 3) * 0.12
      for (const crater of craters) {
        const d =
          Math.acos(Math.min(1, p[0] * crater.at[0] + p[1] * crater.at[1] + p[2] * crater.at[2])) /
          crater.size
        if (d > 1.3) continue
        // The floor a little darker, the rim brighter, the ejecta fading out.
        if (d < 0.8) value -= 0.1 * (1 - d / 0.8)
        else if (d < 1.0) value += 0.12
        else value += (0.05 * (1.3 - d)) / 0.3
      }
      map[y * width + x] = Math.min(1, Math.max(0, value))
    }
  }
  return map
}
