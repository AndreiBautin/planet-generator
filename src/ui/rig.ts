import type { Clock } from '@/app/clock'
import type { CameraView } from '@/render/scene'
import { SEA_RADIUS } from '@/render/water'

import type { GestureHandlers } from './controls'
import { blendOf, dive, ORBITING, rise, settleFlight, steersGlide, type Flight } from './flight'
import {
  advance,
  faceGlide,
  MAX_ALTITUDE,
  MIN_ALTITUDE,
  pinchGlide,
  poseOf,
  startGlide,
  steer,
  stillGlide,
  type Glide,
  type Ground,
  type Vec3,
} from './glide'
import {
  drag,
  grab,
  INITIAL_ORBIT,
  MAX_DISTANCE,
  MAX_PITCH,
  MIN_DISTANCE,
  pinch,
  release,
  settle,
  wheel,
  type Orbit,
} from './orbit'
import {
  arcBetween,
  guideAltitude,
  guideStep,
  guideTurn,
  startGuide,
  stickFor,
  tourTurn,
  type Guide,
  type GuideStop,
} from './tour'

/**
 * The camera's state and what moves it: the orbit, the glide, and which of
 * the two the camera is on or between. Answers the scene's once-a-frame
 * question, advancing everything by the clock first, and turns a gesture
 * into a change to whichever camera a finger is steering at the time.
 */
export interface Rig {
  readonly view: () => CameraView
  readonly gestures: GestureHandlers
  /** Dive into a glide from this point, heading this way. */
  readonly fly: (from: { readonly position: Vec3; readonly heading: Vec3 }) => void
  /** Rise back to the orbit, over the point the glide had reached. */
  readonly land: (
    over: (position: Vec3) => { readonly yaw: number; readonly pitch: number },
  ) => void
  /** Back to the orbit at once — for a new planet, where a rise over the old one would be a lie. */
  readonly cut: () => void
  /**
   * Take the glide under the sea, flying over `floor` (the sea bed) and
   * under the surface; or, with nothing, back up into the air. Says
   * whether it went: not unless gliding over water deep enough to fly in.
   */
  readonly submerge: (floor: Ground | undefined) => boolean
  readonly submerged: () => boolean
  /** Told when the glide comes up by itself: the water grew too shallow (`shallow`), or it left the glide. */
  readonly onSurface: (listener: (shallow: boolean) => void) => void
  /** Whether the glide is the camera a finger steers: diving or gliding. */
  readonly flying: () => boolean
  /** Turn and climb by a step, from the keyboard. */
  readonly nudge: (turn: number, climb: number) => void
  /**
   * Let the glide fly itself (tour.ts), or take it back. Any hand on the
   * controls takes it back too. With stops, it visits each in turn before
   * wandering on.
   */
  readonly tour: (on: boolean, stops?: readonly GuideStop[]) => void
  /** Told as each stop of a guided tour is reached, to name it. */
  readonly onArrive: (listener: (stop: GuideStop) => void) => void
  readonly touring: () => boolean
  /** Told whenever the tour stops or starts, so a button can say so. */
  readonly onTour: (listener: (touring: boolean) => void) => void
  /**
   * Stop the camera where it is, for a picture: `frame` while a postcard
   * is being composed (a drag turns the view, a pinch changes height, and
   * nothing else moves), `still` for a postcard opened from a link (the
   * first touch lets it go and flies on), nothing to let go.
   */
  readonly hold: (mode: Hold | undefined) => void
  /** Told when a touch lets a still view go. */
  readonly onRelease: (listener: () => void) => void
  /** What the camera is on and how high: a glide's altitude, an orbit's distance. */
  readonly height: () => CameraHeight
  readonly setHeight: (height: number) => void
  /** Where a postcard taken now would say it was: the point under the eye, and the way it faces. */
  readonly viewpoint: () =>
    { readonly position: Vec3; readonly heading: Vec3; readonly tilt: number } | undefined
  /** Put the camera straight at a spot, no dive: for a link that opens on one. */
  readonly place: (spot: Spot) => void
  /**
   * Draw the orbit in or out to `distance` over `ms`, eased, and past its
   * usual limits if asked — the journey between worlds pulls far back.
   */
  readonly dolly: (distance: number, ms: number) => void
  /** Told when a hand keeps zooming out past the farthest orbit: asking to see the system. */
  readonly onBeyond: (listener: () => void) => void
}

export type Hold = 'frame' | 'still'

export interface CameraHeight {
  readonly kind: 'glide' | 'orbit'
  readonly value: number
  readonly low: number
  readonly high: number
}

export type Spot =
  | {
      readonly kind: 'glide'
      readonly position: Vec3
      readonly heading: Vec3
      readonly altitude: number
      /** Where the eye looks, radians up from level. */
      readonly tilt: number
    }
  | {
      readonly kind: 'orbit'
      readonly yaw: number
      readonly pitch: number
      readonly distance: number
    }

/**
 * Under the sea: the eye never comes nearer the surface than this, so the
 * waves passing over do not lift it into the air.
 */
const SEA_CEILING = SEA_RADIUS - 0.0012
/** Nor nearer the sea bed than this, as over land. */
const UNDER_CLEARANCE = 0.0025
/** How high over the sea the glide climbs to when it comes up. */
const RISE_TO = 0.008
/**
 * The least depth under the ceiling to dive into: enough water to fly in,
 * not a lagoon. It was 0.006, which put the warm seas — mostly 0.006 to
 * 0.008 deep in all — out of reach, and their reefs with them: the coral
 * could be seen from above and never from below. A little over the
 * clearance the glide keeps off the bed, so a dive has room before it
 * comes up by itself.
 */
const DEEP_ENOUGH = 0.0042

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export function createRig(clock: Clock, ground: () => Ground): Rig {
  // Under the sea, the glide flies over the sea bed and under a ceiling
  // just below the surface (`submerge`).
  let under: Ground | undefined
  let surfaced: (shallow: boolean) => void = () => undefined
  // Coming up, the glide still flies over the sea bed until it is clear of
  // the water: over the sea's surface at once, the clearance above it put
  // the eye there in a single frame.
  let rising: Ground | undefined
  let sunk = false
  const comeUp = (shallow: boolean): void => {
    if (under === undefined) return
    rising = under
    under = undefined
    if (glide !== undefined)
      glide = {
        ...glide,
        altitude: clamp(SEA_RADIUS + RISE_TO - rising(glide.position), MIN_ALTITUDE, MAX_ALTITUDE),
      }
    surfaced(shallow)
  }
  const groundNow = (): Ground => under ?? rising ?? ground()
  let orbit: Orbit = INITIAL_ORBIT
  let glide: Glide | undefined
  let flight: Flight = ORBITING
  let last = clock.now()
  let touring = false
  let touredFor = 0
  let told: (touring: boolean) => void = () => undefined
  let guide: Guide | undefined
  let arrive: (stop: GuideStop) => void = () => undefined
  let held: Hold | undefined
  let released: () => void = () => undefined
  let travel: { from: number; to: number; since: number; ms: number } | undefined
  let beyond: () => void = () => undefined
  // How far a hand has pushed past the farthest orbit, so a single notch
  // of the wheel does not open the system by accident.
  let pushedOut = 0
  const outward = (amount: number): void => {
    if (steersGlide(flight) || orbit.distance < MAX_DISTANCE - 1e-6) {
      pushedOut = 0
      return
    }
    pushedOut += amount
    if (pushedOut > 1) {
      pushedOut = 0
      beyond()
    }
  }
  const setTouring = (on: boolean): void => {
    if (touring === on) return
    touring = on
    touredFor = 0
    told(on)
  }
  // A hand on the controls is the pilot taking over.
  const takeOver = (): void => {
    setTouring(false)
    if (held === 'still') {
      held = undefined
      released()
    }
  }

  const view = (): CameraView => {
    const now = clock.now()
    // Held, nothing moves on: no coast, no flight, no tour.
    const seconds = held === undefined ? (now - last) / 1000 : 0
    last = now
    flight = settleFlight(flight, now)
    if (flight.mode === 'orbit') {
      glide = undefined
      setTouring(false)
    }
    orbit = settle(orbit, seconds)
    if (travel !== undefined) {
      const t = Math.min(1, (now - travel.since) / travel.ms)
      const eased = t * t * (3 - 2 * t)
      // Eased by ratio, so the far end of a long pull-back is not a crawl.
      orbit = { ...orbit, distance: travel.from * Math.pow(travel.to / travel.from, eased) }
      if (t >= 1) travel = undefined
    }
    if (glide !== undefined && touring && steersGlide(flight) && seconds > 0) {
      touredFor += seconds
      let target: Vec3 | undefined
      if (guide !== undefined) {
        const step = guideStep(guide, glide.position, touredFor)
        guide = step.guide
        target = step.target
        if (step.arrived !== undefined) arrive(step.arrived)
      }
      const rate =
        target === undefined
          ? tourTurn(glide, groundNow(), SEA_RADIUS, touredFor)
          : guideTurn(glide, target)
      glide = steer(glide, stickFor(glide, rate, seconds), 0, 1)
      // High to cross the distance to a sight, low to arrive; between
      // sights, the height a glide starts at.
      const goal = target === undefined ? 0.014 : guideAltitude(arcBetween(glide.position, target))
      glide = {
        ...glide,
        altitude: glide.altitude + (goal - glide.altitude) * Math.min(1, seconds * 0.35),
      }
    }
    if (glide !== undefined) glide = advance(glide, seconds, groundNow())
    if (glide !== undefined && under !== undefined) {
      // Too shallow to stay under: come up.
      if (under(glide.position) + UNDER_CLEARANCE > SEA_CEILING) comeUp(true)
      else {
        // The ceiling holds only once the eye has sunk past it: held from
        // the moment of the dive, it put the eye under the water in a frame.
        if (glide.eye <= SEA_CEILING) sunk = true
        if (sunk) glide = { ...glide, eye: Math.min(glide.eye, SEA_CEILING) }
      }
    }
    if (glide !== undefined && rising !== undefined && glide.eye > SEA_RADIUS + UNDER_CLEARANCE) {
      // Clear of the water: back to flying over the surface, still making
      // for the height it was climbing to.
      rising = undefined
      glide = { ...glide, altitude: RISE_TO }
    }
    return {
      orbit,
      surface: glide === undefined ? undefined : poseOf(glide),
      blend: blendOf(flight, now),
    }
  }

  const gestures: GestureHandlers = {
    grab: () => {
      takeOver()
      if (!steersGlide(flight)) orbit = grab(orbit)
    },
    drag: (dx, dy, seconds, height) => {
      if (held === 'frame' && glide !== undefined) {
        // Composing, a drag turns the view where it stands and tilts it up or down.
        const h = Math.max(1, height)
        const turned = faceGlide(glide, (dx / h) * 1.4)
        glide = stillGlide(turned, groundNow(), turned.altitude, turned.pitch - (dy / h) * 1.2)
        return
      }
      if (steersGlide(flight) && glide !== undefined) glide = steer(glide, dx, dy, height)
      else orbit = drag(orbit, dx, dy, seconds, height)
    },
    release: (sinceMove) => {
      if (!steersGlide(flight)) orbit = release(orbit, sinceMove)
    },
    // Height is not the tour's to choose, so a pinch changes it without taking over.
    pinch: (factor) => {
      if (held === 'frame' && glide !== undefined) {
        glide = stillGlide(pinchGlide(glide, factor), groundNow(), undefined, glide.pitch)
        return
      }
      if (steersGlide(flight) && glide !== undefined) glide = pinchGlide(glide, factor)
      else {
        if (factor < 1) outward((1 / factor - 1) * 4)
        orbit = pinch(orbit, factor)
      }
    },
    wheel: (deltaY) => {
      if (held === 'frame' && glide !== undefined) {
        const nearer = pinchGlide(glide, Math.exp(-deltaY * 0.0015))
        glide = stillGlide(nearer, groundNow(), undefined, glide.pitch)
        return
      }
      if (steersGlide(flight) && glide !== undefined)
        glide = pinchGlide(glide, Math.exp(-deltaY * 0.0015))
      else {
        if (deltaY > 0) outward(deltaY / 400)
        orbit = wheel(orbit, deltaY)
      }
    },
  }

  return {
    view,
    gestures,
    fly: (from) => {
      rising = undefined
      glide = startGlide(from.position, from.heading, groundNow())
      flight = dive(flight, clock.now())
    },
    land: (over) => {
      setTouring(false)
      comeUp(false)
      rising = undefined
      if (glide !== undefined) {
        const { yaw, pitch } = over(glide.position)
        // Rise to the orbit's own distance, over the ground just flown, so
        // the planet comes back into view below rather than spinning round.
        const level = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch))
        orbit = { ...grab(orbit), yaw, pitch: level, dragging: false }
      }
      flight = rise(flight, clock.now())
    },
    submerge: (floor) => {
      if (floor === undefined) {
        comeUp(false)
        return true
      }
      if (glide === undefined || !steersGlide(flight)) return false
      const depth = SEA_CEILING - floor(glide.position)
      if (depth < DEEP_ENOUGH) return false
      under = floor
      sunk = false
      // Down near the sea bed, where there is something to see, eased there
      // by the glide's own settling.
      glide = { ...glide, altitude: clamp(depth * 0.3, MIN_ALTITUDE, MAX_ALTITUDE) }
      return true
    },
    submerged: () => under !== undefined,
    onSurface: (listener) => {
      surfaced = listener
    },
    cut: () => {
      comeUp(false)
      rising = undefined
      setTouring(false)
      flight = ORBITING
      glide = undefined
    },
    flying: () => steersGlide(flight),
    nudge: (turn, climb) => {
      takeOver()
      if (glide !== undefined && steersGlide(flight)) glide = steer(glide, turn, climb, 1)
    },
    tour: (on, stops) => {
      guide = on && stops !== undefined && stops.length > 0 ? startGuide(stops) : undefined
      setTouring(on && glide !== undefined)
    },
    onArrive: (listener) => {
      arrive = listener
    },
    touring: () => touring,
    onTour: (listener) => {
      told = listener
    },
    hold: (mode) => {
      held = mode
      if (mode === undefined) return
      setTouring(false)
      // A dive or a rise is finished at once: a picture is of a place, not
      // of the way between two.
      const now = clock.now()
      if (flight.mode === 'diving') flight = { mode: 'gliding', since: now, from: 1 }
      if (flight.mode === 'rising') {
        flight = ORBITING
        glide = undefined
      }
      if (glide !== undefined) glide = stillGlide(glide, groundNow())
      orbit = { ...orbit, yawVelocity: 0, pitchVelocity: 0, dragging: false }
    },
    onRelease: (listener) => {
      released = listener
    },
    height: () =>
      glide !== undefined && steersGlide(flight)
        ? { kind: 'glide', value: glide.altitude, low: MIN_ALTITUDE, high: MAX_ALTITUDE }
        : { kind: 'orbit', value: orbit.distance, low: MIN_DISTANCE, high: MAX_DISTANCE },
    setHeight: (height) => {
      if (glide !== undefined && steersGlide(flight)) {
        glide = stillGlide(glide, groundNow(), height, glide.pitch)
      } else {
        orbit = { ...orbit, distance: Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, height)) }
      }
    },
    viewpoint: () =>
      glide !== undefined && steersGlide(flight)
        ? { position: glide.position, heading: glide.heading, tilt: glide.pitch }
        : undefined,
    dolly: (distance, ms) => {
      travel = { from: orbit.distance, to: distance, since: clock.now(), ms: Math.max(1, ms) }
    },
    onBeyond: (listener) => {
      beyond = listener
    },
    place: (spot) => {
      setTouring(false)
      if (spot.kind === 'glide') {
        const start = startGlide(spot.position, spot.heading, groundNow())
        glide = stillGlide(start, groundNow(), spot.altitude, spot.tilt)
        flight = { mode: 'gliding', since: clock.now(), from: 1 }
      } else {
        glide = undefined
        flight = ORBITING
        orbit = {
          ...INITIAL_ORBIT,
          yaw: spot.yaw,
          pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, spot.pitch)),
          distance: Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, spot.distance)),
        }
      }
    },
  }
}
