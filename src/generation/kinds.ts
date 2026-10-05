import type { Rng } from './rng'

/**
 * The kinds of world a seed can make, and how each one colours itself.
 *
 * A kind is a starting point, not a cage: it sets a base climate, nudges
 * the sea level and picks a palette, and the dials move each from there. A
 * hot dial on a frozen world thaws it; it does not turn it into a desert
 * with an ice palette.
 */
export const PLANET_KINDS = ['temperate', 'oceanic', 'arid', 'frozen', 'volcanic'] as const
export type PlanetKind = (typeof PLANET_KINDS)[number]

export type Rgb = readonly [number, number, number]

export interface Palette {
  readonly deep: Rgb
  readonly shallow: Rgb
  readonly shore: Rgb
  /** Wet lowland: forest, or whatever passes for it. */
  readonly lush: Rgb
  /** Dry lowland: grass, scrub, dunes. */
  readonly dry: Rgb
  readonly highland: Rgb
  readonly peak: Rgb
  /** Snow on land and ice on the sea, where it is cold enough. */
  readonly ice: Rgb
}

export interface KindTraits {
  readonly label: string
  /** Base climate, -1 (frozen) to 1 (scorching), before the dial and latitude. */
  readonly climate: number
  /** Added to the water dial: an ocean world is wetter at the same setting. */
  readonly waterShift: number
  /** The sea is molten rather than water: it glows, and it is never ice. */
  readonly molten: boolean
  readonly palette: Palette
  /** Share of the sky that is cloud, roughly 0 (clear) to 1 (overcast). */
  readonly cloudCover: number
  /** Cloud, or ash on a volcanic world. */
  readonly cloudColour: Rgb
  /** The glow of the air around the limb. */
  readonly atmosphere: Rgb
}

const hex = (value: number): Rgb => [
  ((value >> 16) & 255) / 255,
  ((value >> 8) & 255) / 255,
  (value & 255) / 255,
]

export const KINDS: Readonly<Record<PlanetKind, KindTraits>> = {
  temperate: {
    label: 'Temperate world',
    climate: 0.35,
    waterShift: 0,
    molten: false,
    palette: {
      deep: hex(0x0b1d3f),
      shallow: hex(0x1f6f8f),
      shore: hex(0xd8c890),
      lush: hex(0x2f6b2a),
      dry: hex(0x8f9a4a),
      highland: hex(0x6a5a46),
      peak: hex(0xa59f97),
      ice: hex(0xf2f6fa),
    },
    cloudCover: 0.5,
    cloudColour: hex(0xffffff),
    atmosphere: hex(0x5aa0ff),
  },
  oceanic: {
    label: 'Ocean world',
    climate: 0.45,
    waterShift: 0.25,
    molten: false,
    palette: {
      deep: hex(0x061a3a),
      shallow: hex(0x23b0b8),
      shore: hex(0xf0e2b0),
      lush: hex(0x1f8a4c),
      dry: hex(0x6fae55),
      highland: hex(0x4f7a46),
      peak: hex(0x8a8f86),
      ice: hex(0xeef7fb),
    },
    cloudCover: 0.62,
    cloudColour: hex(0xffffff),
    atmosphere: hex(0x4fc4ff),
  },
  arid: {
    label: 'Desert world',
    climate: 0.75,
    waterShift: -0.35,
    molten: false,
    palette: {
      deep: hex(0x18324a),
      shallow: hex(0x3a8a90),
      shore: hex(0xe8c27a),
      lush: hex(0xb5833f),
      dry: hex(0xd9a35c),
      highland: hex(0x9c5a32),
      peak: hex(0x6e3a22),
      ice: hex(0xf3ead8),
    },
    cloudCover: 0.18,
    cloudColour: hex(0xf3e2c8),
    atmosphere: hex(0xffb877),
  },
  frozen: {
    label: 'Frozen world',
    climate: -0.2,
    waterShift: -0.05,
    molten: false,
    palette: {
      deep: hex(0x0d2240),
      shallow: hex(0x3d7aa0),
      shore: hex(0x9fb4c4),
      lush: hex(0x6f8d96),
      dry: hex(0x92a6b0),
      highland: hex(0x6d7a86),
      peak: hex(0xc9d6e2),
      ice: hex(0xf4f9ff),
    },
    cloudCover: 0.35,
    cloudColour: hex(0xeef4fb),
    atmosphere: hex(0xa8d8ff),
  },
  volcanic: {
    label: 'Volcanic world',
    climate: 0.9,
    waterShift: -0.15,
    molten: true,
    palette: {
      deep: hex(0xff5a12),
      shallow: hex(0xffb03a),
      shore: hex(0x3a2a24),
      lush: hex(0x2b2422),
      dry: hex(0x3d322d),
      highland: hex(0x1d1816),
      peak: hex(0x5a5550),
      ice: hex(0x8a8580),
    },
    cloudCover: 0.45,
    cloudColour: hex(0x4a403a),
    atmosphere: hex(0xff6a2a),
  },
}

/**
 * The kind a seed makes. Temperate and ocean worlds are the commonest, so
 * the first planet somebody sees is most often a recognisable one; the
 * strange kinds are rarer, which is what makes finding one feel like a find.
 */
export function pickKind(rng: Rng): PlanetKind {
  const roll = rng.next()
  if (roll < 0.34) return 'temperate'
  if (roll < 0.56) return 'oceanic'
  if (roll < 0.74) return 'arid'
  if (roll < 0.9) return 'frozen'
  return 'volcanic'
}
