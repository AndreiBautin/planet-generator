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

/** The angle between two unit directions, radians. */
export const arcBetween = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))

/**
 * The turn rate that brings the heading round to `target`, radians a
 * second, positive right: in proportion to how far off it points, and no
 * faster than a firm bank.
 */
export function guideTurn(glide: Glide, target: Vec3): number {
  const p = glide.position
  const d = p[0] * target[0] + p[1] * target[1] + p[2] * target[2]
  // The way to the target along the ground, and how far round from the heading it lies.
  const way = unit([target[0] - p[0] * d, target[1] - p[1] * d, target[2] - p[2] * d])
  const right = cross(glide.heading, p)
  const off = Math.atan2(
    way[0] * right[0] + way[1] * right[1] + way[2] * right[2],
    way[0] * glide.heading[0] + way[1] * glide.heading[1] + way[2] * glide.heading[2],
  )
  return Math.max(-TOUR_TURN * 1.6, Math.min(TOUR_TURN * 1.6, off * 0.9))
}

/**
 * How high to fly with `distance` radians still to go: high to cross an
 * ocean quickly (a glide goes faster the higher it is), low to arrive.
 */
export function guideAltitude(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - 0.04) / 0.3))
  return 0.012 + (0.075 - 0.012) * t * t * (3 - 2 * t)
}

/** A guided tour's place in its round: which stop, and along a river how far. */
export interface Guide {
  readonly stops: readonly GuideStop[]
  readonly index: number
  /** Along a river's course, the point being flown to; nought before reaching it. */
  readonly along: number
  /** When the current stop was reached, in seconds; undefined until then. */
  readonly arrivedAt: number | undefined
  /** Whether the current stop has been named on screen yet. */
  readonly named: boolean
}

export interface GuideStop {
  readonly name: string
  readonly title: string
  /** The point to fly to, and on along, for a river its course. */
  readonly path: readonly Vec3[]
}

/** How near counts as arrived, radians: a little under a minute's glide at the lowest. */
const ARRIVED = 0.018
/** How near a sight is named: in view ahead from a glide's height. */
const SIGHTED = 0.06
/** How long to linger over a sight before setting off for the next, seconds. */
const LINGER = 9

export function startGuide(stops: readonly GuideStop[]): Guide {
  return { stops, index: 0, along: 0, arrivedAt: undefined, named: false }
}

/**
 * One step of the guided tour: where to fly now, and whether a sight has
 * just been reached (to name it on screen). A river is reached at its
 * source and then flown down to its mouth; anything else is circled for
 * a while by the meander before the next. Past the last stop, no target:
 * the tour wanders as it does unguided.
 */
export function guideStep(
  guide: Guide,
  position: Vec3,
  seconds: number,
): {
  readonly guide: Guide
  readonly target: Vec3 | undefined
  readonly arrived: GuideStop | undefined
} {
  const stop = guide.stops[guide.index]
  if (stop === undefined) return { guide, target: undefined, arrived: undefined }
  const point = stop.path[guide.along] ?? stop.path[0]
  if (point === undefined)
    return guideStep({ ...guide, index: guide.index + 1, along: 0 }, position, seconds)
  const next = { ...guide, index: guide.index + 1, along: 0, arrivedAt: undefined, named: false }
  // Named as it comes into view ahead, not once it is under the eye, where
  // a glide looking forward cannot see it.
  const named = !guide.named && arcBetween(position, point) < SIGHTED
  const arrived = named ? stop : undefined
  const seen = guide.named || named
  if (guide.arrivedAt === undefined) {
    if (arcBetween(position, point) > ARRIVED)
      return { guide: { ...guide, named: seen }, target: point, arrived }
    return { guide: { ...guide, named: seen, arrivedAt: seconds }, target: point, arrived }
  }
  // Down a river: on to the next point of its course, a few cells ahead
  // so the turns are smooth, until its mouth.
  if (stop.path.length > 1) {
    let along = guide.along
    while (
      along < stop.path.length - 1 &&
      arcBetween(position, stop.path[along] ?? point) < ARRIVED * 1.5
    ) {
      along += 1
    }
    if (along < stop.path.length - 1) {
      const ahead = stop.path[Math.min(stop.path.length - 1, along + 2)] ?? point
      return { guide: { ...guide, along }, target: ahead, arrived: undefined }
    }
    return { guide: next, target: undefined, arrived: undefined }
  }
  if (seconds - guide.arrivedAt > LINGER)
    return { guide: next, target: undefined, arrived: undefined }
  return { guide, target: undefined, arrived: undefined }
}
