/**
 * Where the camera sits around the planet, and how a finger moves it.
 *
 * Pure: pointer handling turns events into these calls, and the frame loop
 * calls `settle` with elapsed time. Kept apart from the DOM so the feel —
 * how far a drag turns, how long a flick coasts — can be tested and tuned
 * without a browser.
 *
 * The camera orbits rather than the planet turning, so the sun stays put
 * and dragging round to the night side shows it dark, as it would be.
 */
export interface Orbit {
  /** Around the spin axis, in radians. */
  readonly yaw: number
  /** Above or below the equator, in radians, held short of the poles. */
  readonly pitch: number
  /** Distance from the centre, in planet radii. */
  readonly distance: number
  /** Coasting speed after a flick, radians a second. */
  readonly yawVelocity: number
  readonly pitchVelocity: number
  readonly dragging: boolean
}

export const MIN_DISTANCE = 1.9
export const MAX_DISTANCE = 6
export const MAX_PITCH = 1.25
/** A drag the full height of the screen turns the planet this far. */
const TURN_PER_SCREEN = Math.PI
/** How quickly a flick slows: the speed falls by e every 1 / FRICTION seconds. */
const FRICTION = 3.2
/** Below this the coast is over; stops a flick creeping on for ever. */
const REST = 0.002

export const INITIAL_ORBIT: Orbit = {
  yaw: 0,
  pitch: 0.18,
  distance: 3.2,
  yawVelocity: 0,
  pitchVelocity: 0,
  dragging: false,
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

/** A finger went down: any coast stops under it. */
export function grab(orbit: Orbit): Orbit {
  return { ...orbit, yawVelocity: 0, pitchVelocity: 0, dragging: true }
}

/**
 * A finger moved by (dx, dy) pixels over `seconds`, on a screen `height`
 * pixels tall. Measured against the height so a drag feels the same on a
 * phone held upright and a wide monitor. Closer in, a drag turns less, so
 * the ground under the finger moves with it rather than racing away.
 */
export function drag(orbit: Orbit, dx: number, dy: number, seconds: number, height: number): Orbit {
  const scale = (TURN_PER_SCREEN / Math.max(1, height)) * (orbit.distance / INITIAL_ORBIT.distance)
  const yawStep = -dx * scale
  const pitchStep = dy * scale
  const pitch = clamp(orbit.pitch + pitchStep, -MAX_PITCH, MAX_PITCH)
  // Velocity is what the last move implied, so letting go mid-swipe coasts
  // at the speed of the swipe; a long pause before letting go means none.
  const dt = Math.max(seconds, 1 / 240)
  return {
    ...orbit,
    yaw: orbit.yaw + yawStep,
    pitch,
    yawVelocity: yawStep / dt,
    pitchVelocity: (pitch - orbit.pitch) / dt,
  }
}

/** The finger lifted; whatever speed the drag had, it keeps coasting. */
export function release(orbit: Orbit, sinceLastMove: number): Orbit {
  // A finger that stopped and then lifted should not fling the planet with
  // the speed of a move from a moment ago.
  const stale = sinceLastMove > 0.08
  return {
    ...orbit,
    dragging: false,
    yawVelocity: stale ? 0 : orbit.yawVelocity,
    pitchVelocity: stale ? 0 : orbit.pitchVelocity,
  }
}

/** Two fingers spread by `factor` (new gap / old gap): spreading moves in. */
export function pinch(orbit: Orbit, factor: number): Orbit {
  if (!Number.isFinite(factor) || factor <= 0) return orbit
  return { ...orbit, distance: clamp(orbit.distance / factor, MIN_DISTANCE, MAX_DISTANCE) }
}

/** A wheel notch: positive deltas move away, as every map does. */
export function wheel(orbit: Orbit, deltaY: number): Orbit {
  return pinch(orbit, Math.exp(-deltaY * 0.0015))
}

/**
 * Advance a coast by `seconds`. Decays exactly rather than per frame, so a
 * dropped frame coasts the same distance as two short ones.
 */
export function settle(orbit: Orbit, seconds: number): Orbit {
  if (orbit.dragging || seconds <= 0) return orbit
  if (Math.abs(orbit.yawVelocity) < REST && Math.abs(orbit.pitchVelocity) < REST) {
    return orbit.yawVelocity === 0 && orbit.pitchVelocity === 0
      ? orbit
      : { ...orbit, yawVelocity: 0, pitchVelocity: 0 }
  }
  const decay = Math.exp(-FRICTION * seconds)
  // The distance travelled is the integral of v·e^(-kt) over the step.
  const travelled = (1 - decay) / FRICTION
  const pitch = clamp(orbit.pitch + orbit.pitchVelocity * travelled, -MAX_PITCH, MAX_PITCH)
  return {
    ...orbit,
    yaw: orbit.yaw + orbit.yawVelocity * travelled,
    pitch,
    yawVelocity: orbit.yawVelocity * decay,
    // Coasting into the pitch limit stops there rather than pressing on.
    pitchVelocity: Math.abs(pitch) >= MAX_PITCH ? 0 : orbit.pitchVelocity * decay,
  }
}
