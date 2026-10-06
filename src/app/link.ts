import { DEFAULT_DIALS, type Dials } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

/**
 * A planet's address: `?seed=k7fq2xm&w=70&t=-20&r=35`.
 *
 * The seed decides the world and the dials move it; together they are the
 * whole of what a link has to carry for somebody else to see exactly this
 * planet. Dials travel as whole percentages because a link is read by
 * people too, and a dial left at its default is left out of the link.
 *
 * Parsing is total, like the seed's: a dial that is missing, garbled or out
 * of range reads as its default, so a hand-edited link still opens a planet.
 */
export interface Link {
  readonly seed: Seed | undefined
  readonly dials: Dials
  /** Where a postcard was taken from, when the link is one; absent for a plain planet. */
  readonly shot: Shot | undefined
}

/**
 * A postcard's viewpoint, so a shared picture links back to the place it
 * shows, at the hour it was taken: `&shot=g,12.345,-67.890,215,16.0,17.25`.
 *
 * A glide is the point under the eye, the way it faced (degrees from
 * north), its height over the ground in thousandths of a radius and the
 * local hour there. An orbit is the point under the middle of the view,
 * its distance from the centre and the local hour there. Numbers only:
 * turning them back into directions is the camera's business.
 */
export interface Shot {
  readonly kind: 'glide' | 'orbit'
  /** Degrees, -90 to 90. */
  readonly latitude: number
  /** Degrees, -180 to 180. */
  readonly longitude: number
  /** 0 to 24, the local hour at that point. */
  readonly hour: number
  /** Degrees from north, glide only (0 for an orbit). */
  readonly bearing: number
  /** A glide's altitude or an orbit's distance, in planet radii. */
  readonly height: number
  /** Degrees the eye looks up from level, glide only (0 for an orbit, and for a link without one). */
  readonly tilt: number
}

const HEIGHTS = { glide: [0.004, 0.12], orbit: [1.9, 6] } as const

function parseShot(raw: string | null): Shot | undefined {
  if (raw === null) return undefined
  const [kind, ...rest] = raw.split(',')
  const numbers = rest.map((part) => (/^-?\d+(\.\d+)?$/.test(part.trim()) ? Number(part) : NaN))
  if (numbers.some((n) => !Number.isFinite(n))) return undefined
  let shot: Shot
  if (kind === 'g' && (numbers.length === 5 || numbers.length === 6)) {
    const [latitude = 0, longitude = 0, bearing = 0, altitude = 0, hour = 0, tilt = 0] = numbers
    shot = { kind: 'glide', latitude, longitude, bearing, height: altitude / 1000, hour, tilt }
  } else if (kind === 'o' && numbers.length === 4) {
    const [latitude = 0, longitude = 0, distance = 0, hour = 0] = numbers
    shot = { kind: 'orbit', latitude, longitude, bearing: 0, height: distance, hour, tilt: 0 }
  } else {
    return undefined
  }
  const [low, high] = HEIGHTS[shot.kind]
  const sane =
    Math.abs(shot.latitude) <= 90 &&
    Math.abs(shot.longitude) <= 180 &&
    shot.hour >= 0 &&
    shot.hour <= 24 &&
    shot.height >= low &&
    shot.height <= high &&
    Math.abs(shot.tilt) <= 45
  return sane ? shot : undefined
}

function shotParam(shot: Shot): string {
  const at = `${shot.latitude.toFixed(3)},${shot.longitude.toFixed(3)}`
  const hour = shot.hour.toFixed(2)
  return shot.kind === 'glide'
    ? `g,${at},${String(Math.round(shot.bearing))},${(shot.height * 1000).toFixed(1)},${hour},${String(Math.round(shot.tilt))}`
    : `o,${at},${shot.height.toFixed(2)},${hour}`
}

const KEYS = { water: 'w', temperature: 't', roughness: 'r' } as const
const RANGES = {
  water: [0, 1],
  temperature: [-1, 1],
  roughness: [0, 1],
} as const satisfies Record<keyof Dials, readonly [number, number]>

function readDial(params: URLSearchParams, dial: keyof Dials): number {
  const raw = params.get(KEYS[dial])
  if (raw === null || !/^-?\d{1,3}$/.test(raw.trim())) return DEFAULT_DIALS[dial]
  const [low, high] = RANGES[dial]
  const value = Number(raw) / 100
  return value < low || value > high ? DEFAULT_DIALS[dial] : value
}

export function parseLink(search: string): Link {
  const params = new URLSearchParams(search)
  return {
    seed: parseSeed(params.get('seed')),
    dials: {
      water: readDial(params, 'water'),
      temperature: readDial(params, 'temperature'),
      roughness: readDial(params, 'roughness'),
    },
    shot: parseShot(params.get('shot')),
  }
}

export function linkFor(seed: Seed, dials: Dials, shot?: Shot): string {
  const params = new URLSearchParams({ seed })
  for (const dial of ['water', 'temperature', 'roughness'] as const) {
    const percent = Math.round(dials[dial] * 100)
    if (percent !== Math.round(DEFAULT_DIALS[dial] * 100)) params.set(KEYS[dial], String(percent))
  }
  if (shot !== undefined) params.set('shot', shotParam(shot))
  return `?${params.toString()}`
}
