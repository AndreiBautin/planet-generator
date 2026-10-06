import type { Glide, Ground, Vec3 } from './glide'

/**
 * The autopilot behind Tour: a stick input each frame, for a glide to fly
 * itself somewhere worth looking at.
 *
 * It looks a little way ahead, straight on and to either side, and turns
 * towards land: away from open sea, along a coast, into the hills. Over
 * ground that is land every way it meanders on a slow swing of its own,
 * so a long tour is a wandering flight rather than a straight line round
 * the planet. It only turns: height is left to the glide, which already
 * holds its altitude over the ground and climbs for what rises ahead.
 *
 * Pure: the ground is a parameter, as it is for the glide, so the choices
 * can be tested over a made-up landscape.
 */

/** How far ahead it looks, in radians of arc, and how wide to either side. */
const LOOK = [0.03, 0.07] as const
const SPREAD = 0.8
/** The fastest it asks to turn, in radians a second: a gentle bank, never a wrench. */
export const TOUR_TURN = 0.35
/** The meander's own swing, radians a second at its widest, and its period. */
const WANDER = 0.12
const WANDER_SECONDS = 47
/** The stick sensitivity the glide reads a drag with (glide.ts): turn rate per screen of drag, and its decay. */
const YAW_PER_SCREEN = 9
const YAW_DECAY = 2.6

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** The point an arc `angle` long away from `from`, setting off along `toward`. */
function along(from: Vec3, toward: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return unit([
    from[0] * c + toward[0] * s,
    from[1] * c + toward[1] * s,
    from[2] * c + toward[2] * s,
  ])
}

/** How much of a look ahead is land, 0 over open sea to 1 over ground well above it. */
function landAhead(glide: Glide, ground: Ground, sea: number, swing: number): number {
  const side = cross(glide.heading, glide.position)
  const c = Math.cos(swing)
  const s = Math.sin(swing)
  const way = unit([
    glide.heading[0] * c + side[0] * s,
    glide.heading[1] * c + side[1] * s,
    glide.heading[2] * c + side[2] * s,
  ])
  let land = 0
  for (const distance of LOOK) {
    const radius = ground(along(glide.position, way, distance))
    land += Math.min(1, Math.max(0, (radius - sea) / 0.004))
  }
  return land / LOOK.length
}

/**
 * The turn rate the tour wants now, in radians a second, positive right:
 * towards whichever side has more land ahead, and wandering where both do.
 */
export function tourTurn(glide: Glide, ground: Ground, sea: number, seconds: number): number {
  // `side` in landAhead is heading × up, which points to the right.
  const right = landAhead(glide, ground, sea, SPREAD)
  const ahead = landAhead(glide, ground, sea, 0)
  const left = landAhead(glide, ground, sea, -SPREAD)
  const wander = Math.sin((seconds / WANDER_SECONDS) * Math.PI * 2) * WANDER
  // Open sea straight ahead and land to one side: turn for the land hard.
  // Land everywhere: let the meander have it.
  const pull = (right - left) * (1.5 - ahead)
  return Math.max(-TOUR_TURN, Math.min(TOUR_TURN, pull * TOUR_TURN + wander * ahead))
}

/**
 * The stick input, as a sideways drag in screens, that holds the glide's
 * turn rate at `rate` over a frame of `seconds`: what the glide's own decay
 * takes off, plus the step from where the rate is now.
 */
export function stickFor(glide: Glide, rate: number, seconds: number): number {
  const decay = rate * YAW_DECAY * seconds
  const step = (rate - glide.yawRate) * Math.min(1, seconds * 1.5)
  return (decay + step) / YAW_PER_SCREEN
}
