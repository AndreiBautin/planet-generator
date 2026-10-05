import type { Clock } from '@/app/clock'
import type { CameraView } from '@/render/scene'

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
}

export function createRig(clock: Clock, ground: () => Ground): Rig {
  let orbit: Orbit = INITIAL_ORBIT
  let glide: Glide | undefined
  let flight: Flight = ORBITING
  let last = clock.now()

  const view = (): CameraView => {
    const now = clock.now()
    const seconds = (now - last) / 1000
    last = now
    flight = settleFlight(flight, now)
    if (flight.mode === 'orbit') glide = undefined
    orbit = settle(orbit, seconds)
    if (glide !== undefined) glide = advance(glide, seconds, ground())
    return {
      orbit,
      surface: glide === undefined ? undefined : poseOf(glide),
      blend: blendOf(flight, now),
    }
  }

  const gestures: GestureHandlers = {
    grab: () => {
      if (!steersGlide(flight)) orbit = grab(orbit)
    },
    drag: (dx, dy, seconds, height) => {
      if (steersGlide(flight) && glide !== undefined) glide = steer(glide, dx, dy, height)
      else orbit = drag(orbit, dx, dy, seconds, height)
    },
    release: (sinceMove) => {
      if (!steersGlide(flight)) orbit = release(orbit, sinceMove)
    },
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
      flight = ORBITING
      glide = undefined
    },
    flying: () => steersGlide(flight),
    nudge: (turn, climb) => {
      if (glide !== undefined && steersGlide(flight)) glide = steer(glide, turn, climb, 1)
    },
  }
}
