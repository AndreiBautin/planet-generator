import type { Vec3 } from './cube'
import { angleBetween, LANDMARK_PHRASES, type Landmark, type Survey } from './landmarks'
import { surfaceAt, type Planet } from './planet'
import { createRng } from './rng'

/**
 * The cache: one per world, buried where a rule over the landmarks says,
 * and the clue is that rule in words — "halfway from the highest peak to
 * the heart of the widest sea". Reading the planet is the game: the clue
 * names two places anyone can find from orbit, and the cache lies on the
 * great circle between them.
 *
 * The scope, once fitted, says warmer and colder: by angle from the ship
 * in a glide, by blocks from the surveyor on foot. Two scales, because a
 * landing area is three degrees across and a single word for all of it
 * would say nothing once landed.
 */
export interface Cache {
  /** Where it is buried, a unit direction, on land where the world has any. */
  readonly direction: Vec3
  /** The rule in words. */
  readonly clue: string
}

const PARTS = [
  { at: 0.25, words: 'A quarter of the way' },
  { at: 0.5, words: 'Halfway' },
  { at: 0.75, words: 'Three parts of the way' },
] as const

const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** The point a share of the way along the great circle from one direction to another. */
export function alongArc(from: Vec3, to: Vec3, share: number): Vec3 {
  const angle = angleBetween(from, to)
  if (angle < 1e-6) return from
  const a = Math.sin((1 - share) * angle) / Math.sin(angle)
  const b = Math.sin(share * angle) / Math.sin(angle)
  return unit([from[0] * a + to[0] * b, from[1] * a + to[1] * b, from[2] * a + to[2] * b])
}

/**
 * The nearest dry ground to a direction, searched in rings out to a few
 * degrees; the direction itself if nothing dry is that close (a drowned
 * world buries its cache on the sea floor, which can still be dug).
 */
function ashore(planet: Planet, direction: Vec3): Vec3 {
  const dry = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height >= 0.012
  if (dry(direction)) return direction
  const polar = Math.abs(direction[1]) > 0.999
  const east = unit(polar ? [-direction[1], direction[0], 0] : [direction[2], 0, -direction[0]])
  const north: Vec3 = [
    direction[1] * east[2] - direction[2] * east[1],
    direction[2] * east[0] - direction[0] * east[2],
    direction[0] * east[1] - direction[1] * east[0],
  ]
  for (let ring = 1; ring <= 24; ring += 1) {
    const radius = ring * 0.004
    const steps = 8 * ring
    for (let step = 0; step < steps; step += 1) {
      const turn = (step / steps) * 2 * Math.PI
      const dx = Math.cos(turn) * radius
      const dz = Math.sin(turn) * radius
      const candidate = unit([
        direction[0] + east[0] * dx + north[0] * dz,
        direction[1] + east[1] * dx + north[1] * dz,
        direction[2] + east[2] * dx + north[2] * dz,
      ])
      if (dry(candidate)) return candidate
    }
  }
  return direction
}

/** Where a world's cache is, and the clue to it, from its survey. */
export function cacheOf(planet: Planet, survey: Survey): Cache {
  const rng = createRng(planet.seed).fork('cache')
  const first = survey[0]
  if (first === undefined) return { direction: [0, 1, 0], clue: 'Nowhere to be found.' }
  if (survey.length < 2) {
    return {
      direction: ashore(planet, first.direction),
      clue: `At ${LANDMARK_PHRASES[first.kind]}.`,
    }
  }
  // Two different landmarks, far enough apart that the arc between them
  // means something; the pair is drawn, then the share along it.
  let from: Landmark = first
  let to: Landmark = first
  for (
    let tries = 0;
    tries < 12 && (to === from || angleBetween(from.direction, to.direction) < 0.3);
    tries += 1
  ) {
    from = survey[rng.int(0, survey.length - 1)] ?? first
    to = survey[rng.int(0, survey.length - 1)] ?? first
  }
  if (to === from) to = survey.find((mark) => mark !== from) ?? first
  const part = PARTS[rng.int(0, PARTS.length - 1)] ?? PARTS[1]
  const direction = ashore(planet, alongArc(from.direction, to.direction, part.at))
  return {
    direction,
    clue: `${part.words} from ${LANDMARK_PHRASES[from.kind]} to ${LANDMARK_PHRASES[to.kind]}.`,
  }
}

export const SCOPE_READINGS = ['cold', 'cool', 'warm', 'hot', 'burning'] as const
export type ScopeReading = (typeof SCOPE_READINGS)[number]

/** What the scope says of an angle between the ship and the cache, in radians. */
export function scopeInFlight(angle: number): ScopeReading {
  const degrees = (angle * 180) / Math.PI
  if (degrees > 45) return 'cold'
  if (degrees > 20) return 'cool'
  if (degrees > 8) return 'warm'
  if (degrees > 2.5) return 'hot'
  return 'burning'
}

/** What the scope says of a distance on foot, in blocks across the ground. */
export function scopeOnFoot(blocks: number): ScopeReading {
  if (blocks > 96) return 'cold'
  if (blocks > 48) return 'cool'
  if (blocks > 20) return 'warm'
  if (blocks > 6) return 'hot'
  return 'burning'
}
