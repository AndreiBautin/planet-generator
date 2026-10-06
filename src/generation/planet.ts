import { KINDS, pickKind, type Palette, type PlanetKind, type Rgb } from './kinds'
import { planetName } from './name'
import { createNoise3, fbm, ridged, type Noise3 } from './noise'
import { createRng } from './rng'
import type { Seed } from './seed'

/**
 * A planet: everything about it that a seed and the dials decide.
 *
 * `surfaceAt` answers "how high, what is it, and what colour, is the ground
 * here" for any direction from the centre. The renderer asks once per
 * vertex; a test can ask anywhere. Nothing in here knows a mesh exists.
 */
export interface Dials {
  /** How much of the surface is sea, 0 (dry) to 1 (drowned). */
  readonly water: number
  /** Colder to hotter than the kind's own climate, -1 to 1. */
  readonly temperature: number
  /** Gentle to jagged, 0 to 1. */
  readonly roughness: number
  /**
   * Where in its year the planet is, 0 to 1: 0 the north's midsummer, 0.5
   * its midwinter, 0.25 and 0.75 the equinoxes. Moves the sun north and
   * south by the planet's tilt, and the cold with it.
   */
  readonly season: number
}

/**
 * The equinox by default: the sun over the equator, neither hemisphere
 * warmed, so a planet looks as it did before it had a year — and every
 * link made before then opens on the same ground.
 */
export const DEFAULT_DIALS: Dials = { water: 0.55, temperature: 0, roughness: 0.5, season: 0.25 }

export interface Planet {
  readonly seed: Seed
  readonly name: string
  readonly kind: PlanetKind
  readonly dials: Dials
  /** Height above which the ground is dry, in the units `surfaceAt` reports. */
  readonly seaLevel: number
  /** How far the tallest mountains rise above the sea, as a share of the radius. */
  readonly relief: number
  /** Overall warmth, -1 to 1: the kind's climate moved by the dial. */
  readonly climate: number
  /** How far its spin axis leans from upright, radians: how big its seasons are. */
  readonly tilt: number
  readonly molten: boolean
  readonly palette: Palette
  readonly continents: Noise3
  readonly mountains: Noise3
  readonly detail: Noise3
  readonly moisture: Noise3
  readonly clouds: Noise3
  /** Small-scale relief, seen only close up (see relief.ts). */
  readonly fine: Noise3
  readonly cloudCover: number
  /** A random shift of the noise field, so two seeds never share a coastline. */
  readonly offset: readonly [number, number, number]
}

/** What the ground is, which decides its colour and later its material. */
export type Biome = 'deep' | 'shallow' | 'sea-ice' | 'shore' | 'land' | 'highland' | 'snow'

export interface Surface {
  /** Elevation relative to sea level: negative is sea floor, positive is land. */
  readonly height: number
  readonly biome: Biome
  /** Linear RGB, each 0 to 1. */
  readonly colour: Rgb
  /** How wet the ground is, 0 to 1: the field the biomes' colours already read. */
  readonly moisture: number
  /** How warm, around −1 to 1: climate less latitude and height. */
  readonly warmth: number
}

/** Clamp a dial to its range; a dial from a link is never trusted. */
const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low

export function createPlanet(seed: Seed, dials: Dials = DEFAULT_DIALS): Planet {
  const rng = createRng(seed)
  const shape = rng.fork('shape')
  const kind = pickKind(rng.fork('kind'))
  const traits = KINDS[kind]
  const water = clamp(dials.water, 0, 1)
  const temperature = clamp(dials.temperature, -1, 1)
  const roughness = clamp(dials.roughness, 0, 1)
  const season = clamp(dials.season, 0, 1)
  return {
    seed,
    name: planetName(rng.fork('name')),
    kind,
    dials: { water, temperature, roughness, season },
    // Raising the sea floods the land; the continents' noise sits around 0,
    // so a sea level from -0.25 to 0.25 spans mostly dry to mostly wet.
    seaLevel: (clamp(water + traits.waterShift, 0, 1) - 0.5) * 0.5,
    relief: 0.035 + roughness * 0.045,
    climate: clamp(traits.climate + temperature * 0.8, -1.2, 1.2),
    // From a few degrees to about thirty-five: from barely any seasons to
    // a midnight sun well down from the poles.
    tilt: rng.fork('tilt').range(0.05, 0.6),
    molten: traits.molten,
    palette: traits.palette,
    continents: createNoise3(rng.fork('continents')),
    mountains: createNoise3(rng.fork('mountains')),
    detail: createNoise3(rng.fork('detail')),
    moisture: createNoise3(rng.fork('moisture')),
    clouds: createNoise3(rng.fork('clouds')),
    fine: createNoise3(rng.fork('fine')),
    cloudCover: traits.cloudCover,
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

/**
 * How far north of the equator the sun stands, radians: the tilt, turned
 * through the year. Positive is the north's summer.
 */
export function sunDeclination(planet: Pick<Planet, 'tilt' | 'dials'>): number {
  return planet.tilt * Math.cos(planet.dials.season * Math.PI * 2)
}

/** Height, biome and colour at a point; the direction need not be unit length. */
export function surfaceAt(planet: Planet, x: number, y: number, z: number): Surface {
  const length = Math.hypot(x, y, z) || 1
  const ux = x / length
  const uy = y / length
  const uz = z / length
  const height = elevationAt(planet, ux, uy, uz) - planet.seaLevel
  const [ox, oy, oz] = planet.offset
  const wet = fbm(planet.moisture, (ux - oz) * 1.6, (uy + ox) * 1.6, (uz + oy) * 1.6, 4) * 0.5 + 0.5
  // Colder towards the poles and with altitude; the y axis is the spin axis.
  // The moisture field also roughens the line: latitude alone cut the ice
  // edge as a ruler-straight band.
  // And the season: the hemisphere the sun stands over is warmer, more so
  // towards its pole, which has the sun all day; the other, colder.
  const warmth =
    planet.climate -
    Math.abs(uy) * 1.15 -
    Math.max(0, height) * 0.9 +
    (wet - 0.5) * 0.45 +
    uy * Math.sin(sunDeclination(planet)) * 1.1
  const biome = biomeFor(planet, height, warmth)
  return {
    height,
    biome,
    colour: colourFor(planet.palette, biome, height, wet),
    moisture: wet,
    warmth,
  }
}

function biomeFor(planet: Planet, height: number, warmth: number): Biome {
  if (height < 0) {
    if (!planet.molten && warmth < -0.45) return 'sea-ice'
    return height < -0.14 ? 'deep' : 'shallow'
  }
  if (warmth < -0.3) return 'snow'
  if (height < 0.025) return 'shore'
  return height < 0.42 ? 'land' : 'highland'
}

function colourFor(palette: Palette, biome: Biome, height: number, wet: number): Rgb {
  switch (biome) {
    case 'deep':
      return mix(palette.deep, palette.shallow, Math.max(0, (height + 0.4) / 0.26) * 0.35)
    case 'shallow':
      return mix(palette.deep, palette.shallow, (height + 0.14) / 0.14)
    case 'sea-ice':
      // Pack ice cracked by darker leads, so an ice cap is not one flat white.
      return mix(palette.ice, palette.shallow, 0.08 + (1 - wet) * 0.3)
    case 'shore':
      return palette.shore
    case 'land':
      return mix(
        mix(palette.dry, palette.lush, wet),
        palette.highland,
        Math.max(0, height - 0.22) / 0.2,
      )
    case 'highland':
      return mix(palette.highland, palette.peak, Math.min(1, (height - 0.42) / 0.3))
    case 'snow':
      // Wind-scoured ground shows through where it is dry and high, which is
      // what gives a frozen world any shape at all.
      return mix(palette.ice, palette.highland, (1 - wet) * 0.6 + Math.max(0, height - 0.3) * 0.6)
  }
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t))
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ]
}
