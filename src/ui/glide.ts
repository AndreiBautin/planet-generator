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
 * The flight never asks to be flown: it goes forward on its own. A finger
 * is a stick, not a hand on the camera: a drag sets how fast the nose is
 * turning and where it is pitching to, and the aircraft follows — the
 * heading swings, the nose comes up, the wings bank into the turn — over
 * the next second or two rather than at once. Let go and it levels itself.
 * That is what makes a fling feel like flying rather than like the view
 * being dragged about.
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
  /** Nose up (positive) or down, in radians: where the aircraft is pitched now. */
  readonly pitch: number
  /** Where the stick is asking the nose to go; the pitch eases towards it. */
  readonly pitchGoal: number
  /** How fast the heading is turning, in radians a second; positive is right. */
  readonly yawRate: number
  /** Bank, in radians, positive rolling right into a right turn. */
  readonly roll: number
  /**
   * Speed gained by diving and spent by climbing, as a share of the base
   * speed: a dive to the deck is quick, a zoom climb slows and bleeds off.
   */
  readonly rush: number
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
/** The eye looks this far below the horizon, in radians, when level. */
export const LOOK_DOWN = 0.22
/**
 * A drag the full height of the screen adds this much turn rate, in radians
 * a second: with the decay below, about half a turn. It was a quarter, and
 * reported as going all the way across the screen and barely turning.
 */
const YAW_PER_SCREEN = 5.5
/** The turn rate dies away by e every 1/RATE seconds once the finger lifts. */
const YAW_DECAY = 1.6
export const MAX_YAW_RATE = 2.4
/** A drag the full height of the screen asks for this much pitch. */
const PITCH_PER_SCREEN = 1.6
export const MAX_PITCH_UP = 0.55
export const MAX_PITCH_DOWN = 0.5
/** The nose follows the stick by e every 1/RATE seconds. */
const PITCH_FOLLOW = 4.5
/** The stick comes back to the middle by e every 1/RATE seconds once left alone. */
const LEVEL_RATE = 0.7
/** How much of the speed a full pitch turns into climb or dive. */
const CLIMB_SHARE = 1.6
/** How fast a full dive gains rush, per second, and how quickly it bleeds away level. */
const RUSH_GAIN = 1.1
const RUSH_DECAY = 0.45
export const MAX_RUSH = 1.0
/** Bank per radian a second of turn, and how quickly the wings follow. */
const BANK_PER_YAW = 0.32
export const MAX_ROLL = 0.6
const ROLL_FOLLOW = 4

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

/**
 * How fast it travels, in radians a second: quicker higher up, so the
 * ground passes at a steady pace, and quicker again with the rush of a
 * dive.
 */
export const speedOf = (glide: Glide): number => (0.006 + glide.altitude * 1.4) * (1 + glide.rush)

export function startGlide(position: Vec3, heading: Vec3, ground: Ground): Glide {
  const at = unit(position)
  return {
    position: at,
    heading: flatten(heading, at),
    altitude: START_ALTITUDE,
    eye: ground(at) + START_ALTITUDE,
    pitch: 0,
    pitchGoal: 0,
    yawRate: 0,
    roll: 0,
    rush: 0,
  }
}

/**
 * A finger moved by (dx, dy) on a screen `height` pixels tall: sideways
 * adds to the rate of turn, up asks the nose up and down asks it down — the
 * way the finger moves is the way the aircraft goes, which needs no
 * explaining on a phone. Nothing moves here; `advance` flies it there.
 */
export function steer(glide: Glide, dx: number, dy: number, height: number): Glide {
  const h = Math.max(1, height)
  // Turning right is a clockwise turn seen from above, a negative angle
  // about the up direction; the rate is kept positive-right.
  const yawRate = clamp(glide.yawRate + (dx / h) * YAW_PER_SCREEN, -MAX_YAW_RATE, MAX_YAW_RATE)
  // Screen y grows downwards: a finger moving up is a positive pitch.
  const pitchGoal = clamp(
    glide.pitchGoal - (dy / h) * PITCH_PER_SCREEN,
    -MAX_PITCH_DOWN,
    MAX_PITCH_UP,
  )
  return { ...glide, yawRate, pitchGoal }
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

/** How hard the glide leans towards land when left alone over the sea, in radians a second. */
const SHORE_PULL = 0.18
/** Below this turn rate the glide counts as left alone: a finger on the stick is never overruled. */
const HANDS_OFF = 0.04
/** Ground a whisker above the lowest drawn level is land; the sea is drawn flat at the bottom. */
const LAND_ABOVE = 0.0004

/**
 * Which way to lean, left alone over open sea: towards the side with land on
 * it, so a glide over an island world does not run off the island and out to
 * a featureless ocean in a few seconds. Nought over land, nought when the
 * pilot is steering, nought when there is land on neither side or both.
 */
export function shoreLean(glide: Glide, ground: Ground): number {
  if (Math.abs(glide.yawRate) > HANDS_OFF) return 0
  const sea = ground(glide.position)
  const reach = speedOf(glide) * 4
  // Land at a heading `turn` radians to the right, within a few seconds'
  // flight or twice that: the nearest bearing that has some wins.
  const landAt = (turn: number): boolean => {
    const heading = rotate(glide.heading, glide.position, -turn)
    const axis = unit(cross(glide.position, heading))
    return [1, 2, 3].some((k) => ground(rotate(glide.position, axis, reach * k)) > sea + LAND_ABOVE)
  }
  if (landAt(0)) return 0
  for (const turn of [0.5, 1, 1.6, 2.2, 2.8]) {
    const right = landAt(turn)
    const left = landAt(-turn)
    if (right && !left) return SHORE_PULL
    if (left && !right) return -SHORE_PULL
    if (left && right) return 0
  }
  return 0
}

const follow = (value: number, goal: number, rate: number, step: number): number =>
  goal + (value - goal) * Math.exp(-rate * step)

/**
 * Fly forward for `seconds`. Travel along a great circle — the straightest
 * line there is on a sphere — turning at the current rate, with the nose
 * following the stick and the wings banking into the turn; ease the eye
 * towards the altitude over the highest ground just ahead, so it rises
 * before a ridge rather than into it.
 */
export function advance(glide: Glide, seconds: number, ground: Ground): Glide {
  if (!(seconds > 0)) return glide
  const step = Math.min(seconds, 0.25)
  // Turn first, by the rate, which then dies away on its own — plus the
  // lean towards land when left alone over the sea, applied to the heading
  // directly so it never reads as the pilot's own turn and switches itself
  // off.
  const lean = shoreLean(glide, ground)
  const turned = flatten(
    rotate(glide.heading, glide.position, -(glide.yawRate + lean) * step),
    glide.position,
  )
  const yawRate = glide.yawRate * Math.exp(-YAW_DECAY * step)
  const axis = unit(cross(glide.position, turned))
  const angle = speedOf(glide) * step
  const position = unit(rotate(glide.position, axis, angle))
  const heading = flatten(rotate(turned, axis, angle), position)
  // The nose follows the stick, and the stick drifts back to the middle;
  // the pitch is how fast the altitude changes, as a share of the speed.
  const pitchGoal = glide.pitchGoal * Math.exp(-LEVEL_RATE * step)
  const pitch = follow(glide.pitch, pitchGoal, PITCH_FOLLOW, step)
  const climb = Math.sin(pitch) * speedOf(glide) * CLIMB_SHARE * step
  const altitude = clamp(
    glide.altitude * Math.exp(climb / glide.altitude),
    MIN_ALTITUDE,
    MAX_ALTITUDE,
  )
  const roll = follow(
    glide.roll,
    clamp((yawRate + lean) * BANK_PER_YAW, -MAX_ROLL, MAX_ROLL),
    ROLL_FOLLOW,
    step,
  )
  // Energy: nose down and the speed builds, nose up and it is spent; level,
  // it settles back to cruising.
  const rush = clamp(
    glide.rush * Math.exp(-RUSH_DECAY * step) - Math.sin(pitch) * RUSH_GAIN * step,
    -0.35,
    MAX_RUSH,
  )
  const moved = { ...glide, position, heading, yawRate, altitude, pitch, pitchGoal, roll, rush }
  const target = groundAhead(moved, ground) + altitude
  const settled = target + (glide.eye - target) * Math.exp(-SETTLE_RATE * step)
  const floor = ground(position) + CLEARANCE
  return { ...moved, eye: Math.max(settled, floor) }
}

export interface Pose {
  /** Where the eye is. */
  readonly eye: Vec3
  /** A point it looks at. */
  readonly look: Vec3
  /** Which way is up for the eye: away from the centre, rolled by the bank. */
  readonly up: Vec3
  /** How much of a dive's rush it is carrying, 0 to 1: the lens widens with it. */
  readonly rush: number
}

export function poseOf(glide: Glide): Pose {
  const eye = scale(glide.position, glide.eye)
  // The eye looks where the nose points: a little down when level, up at
  // the sky in a climb, at the ground in a dive — and the horizon tilts
  // with the wings in a turn.
  const tilt = LOOK_DOWN - glide.pitch
  const forward = unit(
    add(scale(glide.heading, Math.cos(tilt)), scale(glide.position, -Math.sin(tilt))),
  )
  return {
    eye,
    look: add(eye, forward),
    up: rotate(glide.position, forward, -glide.roll),
    rush: clamp(glide.rush, 0, 1),
  }
}
