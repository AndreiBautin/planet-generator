/**
 * Gliding low over the ground: where the eye is, which way it is going, and
 * how a finger steers it. All in the planet's own frame, as unit directions
 * from the centre, so a turning planet carries the flight with it.
 *
 * Pure, like `orbit.ts`. The ground is a parameter — a function from a
 * direction to the radius of the ground there — so the flight can be
 * tested over a made-up landscape, and so the renderer stays the only
 * thing that knows how ground is drawn.
 *
 * The flight never asks to be flown: it goes forward on its own, a finger
 * only turns it and raises or lowers it. On a phone that is what makes it
 * flyable with one thumb.
 */
export type Vec3 = readonly [number, number, number]
export type Ground = (direction: Vec3) => number

export interface Glide {
  /** The point beneath the eye, as a unit direction. */
  readonly position: Vec3
  /** Which way it is heading: a unit vector along the ground. */
  readonly heading: Vec3
  /** How high above the ground it means to fly. */
  readonly altitude: number
  /** How far from the centre the eye actually is, easing towards ground + altitude. */
  readonly eye: number
}

export const MIN_ALTITUDE = 0.004
export const MAX_ALTITUDE = 0.12
export const START_ALTITUDE = 0.016
/** However the eye is easing, it never comes closer to the ground than this. */
const CLEARANCE = 0.0025
/** How far ahead the flight looks for rising ground, in seconds of travel. */
const LOOK_AHEAD_SECONDS = 1.6
/** How quickly the eye settles onto its height: by e every 1/RATE seconds. */
const SETTLE_RATE = 2.6
/** The eye looks this far below the horizon, in radians. */
export const LOOK_DOWN = 0.22
/** A drag the full height of the screen turns this far. */
const TURN_PER_SCREEN = Math.PI * 0.8

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const scale = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

/** Rotate v about a unit axis by an angle (Rodrigues). */
function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return add(add(scale(v, cos), scale(cross(axis, v), sin)), scale(axis, dot(axis, v) * (1 - cos)))
}

/** A heading made to lie flat along the ground at a point. */
function flatten(heading: Vec3, position: Vec3): Vec3 {
  const along = add(heading, scale(position, -dot(heading, position)))
  // Straight up or down has no direction along the ground: pick one.
  if (Math.hypot(along[0], along[1], along[2]) < 1e-6) return unit(cross(position, [0, 0, 1]))
  return unit(along)
}

/** How fast it travels, in radians a second: quicker higher up, so the ground passes at a steady pace. */
export const speedOf = (glide: Glide): number => 0.006 + glide.altitude * 1.4

export function startGlide(position: Vec3, heading: Vec3, ground: Ground): Glide {
  const at = unit(position)
  return {
    position: at,
    heading: flatten(heading, at),
    altitude: START_ALTITUDE,
    eye: ground(at) + START_ALTITUDE,
  }
}

/**
 * A finger moved by (dx, dy) on a screen `height` pixels tall: sideways
 * turns, up climbs and down dives — the way the finger moves is the way the
 * eye goes, which needs no explaining on a phone.
 */
export function steer(glide: Glide, dx: number, dy: number, height: number): Glide {
  const turn = (dx / Math.max(1, height)) * TURN_PER_SCREEN
  // Turning right is a clockwise turn seen from above, a negative angle
  // about the up direction.
  const heading = flatten(rotate(glide.heading, glide.position, -turn), glide.position)
  const altitude = clamp(
    glide.altitude * Math.exp(-dy / Math.max(1, height)),
    MIN_ALTITUDE,
    MAX_ALTITUDE,
  )
  return { ...glide, heading, altitude }
}

/** Two fingers spread by `factor`: spreading comes down closer. */
export function pinchGlide(glide: Glide, factor: number): Glide {
  if (!Number.isFinite(factor) || factor <= 0) return glide
  return { ...glide, altitude: clamp(glide.altitude / factor, MIN_ALTITUDE, MAX_ALTITUDE) }
}

/** The highest ground over the next stretch of the flight path. */
function groundAhead(glide: Glide, ground: Ground): number {
  const axis = unit(cross(glide.position, glide.heading))
  const reach = speedOf(glide) * LOOK_AHEAD_SECONDS
  let highest = ground(glide.position)
  for (let step = 1; step <= 4; step += 1) {
    highest = Math.max(highest, ground(rotate(glide.position, axis, (reach * step) / 4)))
  }
  return highest
}

/**
 * Fly forward for `seconds`. Travel along a great circle — the straightest
 * line there is on a sphere — and ease the eye towards the altitude over the
 * highest ground just ahead, so it rises before a ridge rather than into it.
 */
export function advance(glide: Glide, seconds: number, ground: Ground): Glide {
  if (!(seconds > 0)) return glide
  const step = Math.min(seconds, 0.25)
  const axis = unit(cross(glide.position, glide.heading))
  const angle = speedOf(glide) * step
  const position = unit(rotate(glide.position, axis, angle))
  const heading = flatten(rotate(glide.heading, axis, angle), position)
  const moved = { ...glide, position, heading }
  const target = groundAhead(moved, ground) + glide.altitude
  const settled = target + (glide.eye - target) * Math.exp(-SETTLE_RATE * step)
  const floor = ground(position) + CLEARANCE
  return { ...moved, eye: Math.max(settled, floor) }
}

export interface Pose {
  /** Where the eye is. */
  readonly eye: Vec3
  /** A point it looks at. */
  readonly look: Vec3
  /** Which way is up for the eye: away from the centre. */
  readonly up: Vec3
}

export function poseOf(glide: Glide): Pose {
  const eye = scale(glide.position, glide.eye)
  const forward = add(
    scale(glide.heading, Math.cos(LOOK_DOWN)),
    scale(glide.position, -Math.sin(LOOK_DOWN)),
  )
  return { eye, look: add(eye, forward), up: glide.position }
}
