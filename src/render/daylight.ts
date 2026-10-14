import { smooth } from './frames'

/**
 * How much of the day is left where the eye is, as the numbers every light
 * in the scene is set from: pure, so dusk can be tested without a GPU.
 * `elevation` is the sun's height over the eye's horizon (the dot of the
 * eye's up and the sun's direction); `above` the eye's height in radii.
 */
export interface Daylight {
  /** 1 low in the air, 0 from orbit, where haze and sky colour give way. */
  readonly low: number
  /** The sun's own light: gone a little below the horizon. */
  readonly day: number
  /**
   * The sky's light, which stays a while after the sun has gone — what
   * twilight is. Read off `day`, the land went black under a bright sky.
   */
  readonly twilight: number
  /** How much the stars, the galaxy and the sister worlds show. */
  readonly starsSeen: number
  /** The haze, so a hill at the horizon (about √(2h) away) is half seen. */
  readonly fogDensity: number
  /** The sky's light on the ground, with extra at dusk when the sky is what the land is seen by. */
  readonly skylight: number
}

export function daylightAt(elevation: number, above: number): Daylight {
  const low = 1 - smooth(0.08, 0.35, above)
  const day = smooth(-0.15, 0.3, elevation)
  const twilight = smooth(-0.2, 0.1, elevation)
  const starlit = 1 - smooth(-0.2, -0.03, elevation)
  return {
    low,
    day,
    twilight,
    starsSeen: 1 - low * (1 - starlit) * 0.95,
    fogDensity: low * (0.65 / Math.sqrt(2 * Math.max(above, 0.002))),
    skylight: 0.18 + 0.47 * twilight + 0.6 * twilight * (1 - day),
  }
}
