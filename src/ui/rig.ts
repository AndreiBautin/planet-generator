import type { Clock } from '@/app/clock'
import type { CameraView } from '@/render/scene'
import { SEA_RADIUS } from '@/render/water'

import type { GestureHandlers } from './controls'
import { blendOf, dive, ORBITING, rise, settleFlight, steersGlide, type Flight } from './flight'
import {
  advance,
  pinchGlide,
  poseOf,
  startGlide,
  steer,
  type Glide,
  type Ground,
  type Vec3,
} from './glide'
import {
  drag,
  grab,
  INITIAL_ORBIT,
  MAX_PITCH,
  pinch,
  release,
  settle,
  wheel,
  type Orbit,
} from './orbit'
import { stickFor, tourTurn } from './tour'

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
  /** Whether the glide is the camera a finger steers: diving or gliding. */
  readonly flying: () => boolean
  /** Turn and climb by a step, from the keyboard. */
  readonly nudge: (turn: number, climb: number) => void
  /** Let the glide fly itself (tour.ts), or take it back. Any hand on the controls takes it back too. */
  readonly tour: (on: boolean) => void
  readonly touring: () => boolean
  /** Told whenever the tour stops or starts, so a button can say so. */
  readonly onTour: (listener: (touring: boolean) => void) => void
}

export function createRig(clock: Clock, ground: () => Ground): Rig {
  let orbit: Orbit = INITIAL_ORBIT
  let glide: Glide | undefined
  let flight: Flight = ORBITING
  let last = clock.now()
  let touring = false
  let touredFor = 0
  let told: (touring: boolean) => void = () => undefined
  const setTouring = (on: boolean): void => {
    if (touring === on) return
    touring = on
    touredFor = 0
    told(on)
  }
  // A hand on the controls is the pilot taking over.
  const takeOver = (): void => {
    setTouring(false)
  }

  const view = (): CameraView => {
    const now = clock.now()
    const seconds = (now - last) / 1000
    last = now
    flight = settleFlight(flight, now)
    if (flight.mode === 'orbit') {
      glide = undefined
      setTouring(false)
    }
    orbit = settle(orbit, seconds)
    if (glide !== undefined && touring && steersGlide(flight) && seconds > 0) {
      touredFor += seconds
      const rate = tourTurn(glide, ground(), SEA_RADIUS, touredFor)
      glide = steer(glide, stickFor(glide, rate, seconds), 0, 1)
    }
    if (glide !== undefined) glide = advance(glide, seconds, ground())
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
      if (steersGlide(flight) && glide !== undefined) glide = steer(glide, dx, dy, height)
      else orbit = drag(orbit, dx, dy, seconds, height)
    },
    release: (sinceMove) => {
      if (!steersGlide(flight)) orbit = release(orbit, sinceMove)
    },
    // Height is not the tour's to choose, so a pinch changes it without taking over.
    pinch: (factor) => {
      if (steersGlide(flight) && glide !== undefined) glide = pinchGlide(glide, factor)
      else orbit = pinch(orbit, factor)
    },
    wheel: (deltaY) => {
      if (steersGlide(flight) && glide !== undefined)
        glide = pinchGlide(glide, Math.exp(-deltaY * 0.0015))
      else orbit = wheel(orbit, deltaY)
    },
  }

  return {
    view,
    gestures,
    fly: (from) => {
      glide = startGlide(from.position, from.heading, ground())
      flight = dive(flight, clock.now())
    },
    land: (over) => {
      setTouring(false)
      if (glide !== undefined) {
        const { yaw, pitch } = over(glide.position)
        // Rise to the orbit's own distance, over the ground just flown, so
        // the planet comes back into view below rather than spinning round.
        const level = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch))
        orbit = { ...grab(orbit), yaw, pitch: level, dragging: false }
      }
      flight = rise(flight, clock.now())
    },
    cut: () => {
      setTouring(false)
      flight = ORBITING
      glide = undefined
    },
    flying: () => steersGlide(flight),
    nudge: (turn, climb) => {
      takeOver()
      if (glide !== undefined && steersGlide(flight)) glide = steer(glide, turn, climb, 1)
    },
    tour: (on) => {
      setTouring(on && glide !== undefined)
    },
    touring: () => touring,
    onTour: (listener) => {
      told = listener
    },
  }
}
