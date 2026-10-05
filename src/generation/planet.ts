import { createNoise3, fbm, ridged, type Noise3 } from './noise'
import { createRng } from './rng'
import type { Seed } from './seed'

/**
 * A planet: everything about it that a seed and the dials decide.
 *
 * `surfaceAt` answers "how high, and what colour, is the ground here" for
 * any direction from the centre. The renderer asks it once per vertex; a
 * test can ask it anywhere. Nothing in here knows a mesh exists.
 */
export interface Dials {
  /** How much of the surface is sea, 0 (dry) to 1 (drowned). */
  readonly water: number
  /** Cold to hot, -1 to 1. */
  readonly temperature: number
  /** Gentle to jagged, 0 to 1. */
  readonly roughness: number
}

export const DEFAULT_DIALS: Dials = { water: 0.55, temperature: 0, roughness: 0.5 }

export interface Planet {
  readonly seed: Seed
  readonly dials: Dials
  /** Height above which the ground is dry, in the units `surfaceAt` reports. */
  readonly seaLevel: number
  /** How far the tallest mountains rise above the sea, as a share of the radius. */
  readonly relief: number
  readonly continents: Noise3
  readonly mountains: Noise3
  readonly detail: Noise3
  /** A random rotation of the noise field, so two seeds never share a coastline. */
  readonly offset: readonly [number, number, number]
}

export interface Surface {
  /** Elevation relative to sea level: negative is sea floor, positive is land. */
  readonly height: number
  /** Linear RGB, each 0 to 1. */
  readonly colour: readonly [number, number, number]
}

/** Clamp a dial to its range; a dial from a link is never trusted. */
const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low

export function createPlanet(seed: Seed, dials: Dials = DEFAULT_DIALS): Planet {
  const rng = createRng(seed)
  const shape = rng.fork('shape')
  const water = clamp(dials.water, 0, 1)
  const roughness = clamp(dials.roughness, 0, 1)
  return {
    seed,
    dials: { water, temperature: clamp(dials.temperature, -1, 1), roughness },
    // Raising the sea floods the land; the continents' noise sits around 0,
    // so a sea level from -0.25 to 0.25 spans mostly dry to mostly wet.
    seaLevel: (water - 0.5) * 0.5,
    relief: 0.035 + roughness * 0.045,
    continents: createNoise3(rng.fork('continents')),
    mountains: createNoise3(rng.fork('mountains')),
    detail: createNoise3(rng.fork('detail')),
    offset: [shape.range(-100, 100), shape.range(-100, 100), shape.range(-100, 100)],
  }
}

/**
 * The raw elevation at a point on the unit sphere, before the sea: broad
 * continents, mountain ranges that rise only inland, and fine detail.
 */
export function elevationAt(planet: Planet, x: number, y: number, z: number): number {
  const [ox, oy, oz] = planet.offset
  const px = x + ox
  const py = y + oy
  const pz = z + oz
  const continent = fbm(planet.continents, px * 1.1, py * 1.1, pz * 1.1, 5)
  // Mountains only where there is land to stand on, rising towards the
  // middle of a continent rather than out of the sea.
  const inland = Math.min(1, Math.max(0, (continent - planet.seaLevel) * 4))
  const ranges = ridged(planet.mountains, px * 2.3, py * 2.3, pz * 2.3, 5)
  const roughness = planet.dials.roughness
  const detail = fbm(planet.detail, px * 6, py * 6, pz * 6, 4) * 0.06 * (0.5 + roughness)
  return continent + inland * ranges * (0.25 + roughness * 0.45) + detail
}

/** Height and colour at a point; the direction need not be unit length. */
export function surfaceAt(planet: Planet, x: number, y: number, z: number): Surface {
  const length = Math.hypot(x, y, z) || 1
  const height = elevationAt(planet, x / length, y / length, z / length) - planet.seaLevel
  return { height, colour: colourFor(height) }
}

/**
 * The ground's colour by height alone. Biomes, latitude and planet types
 * replace this ramp; it exists so terrain can be judged by eye first.
 */
function colourFor(height: number): readonly [number, number, number] {
  if (height < -0.18) return [0.02, 0.05, 0.16]
  if (height < 0) return mix([0.02, 0.05, 0.16], [0.06, 0.24, 0.42], (height + 0.18) / 0.18)
  if (height < 0.02) return [0.76, 0.7, 0.5]
  if (height < 0.3) return mix([0.18, 0.36, 0.12], [0.33, 0.42, 0.18], height / 0.3)
  if (height < 0.6) return mix([0.33, 0.42, 0.18], [0.42, 0.36, 0.3], (height - 0.3) / 0.3)
  return mix([0.42, 0.36, 0.3], [0.95, 0.96, 0.98], Math.min(1, (height - 0.6) / 0.15))
}

function mix(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): readonly [number, number, number] {
  const k = Math.min(1, Math.max(0, t))
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ]
}
