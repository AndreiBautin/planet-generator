import type { Clock } from '@/app/clock'
import { AREA, directionOf, type Frame } from '@/generation/voxel'
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
import {
  eyeOf,
  standWalker,
  stepWalker,
  STILL,
  type StuffAt,
  type Walker,
  type WalkInput,
} from './walker'

/**
 * The camera's state and what moves it: the orbit, the glide, the walk,
 * and which of them the camera is on or between. Answers the scene's
 * once-a-frame question, advancing everything by the clock first, and
 * turns a gesture into a change to whichever camera a finger is steering
 * at the time.
 *
 * Walking sits on top of the glide: a drop freezes the glide where it is
 * and stands the surveyor on the landing; a take-off puts the glide back
 * over the column they walked to. So the orbit-to-glide blend is untouched
 * by a landing, and Land from a walk is a take-off and a rise.
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
  /** Whether the surveyor is on the ground. */
  readonly walking: () => boolean
  /** Turn and climb by a step, from the keyboard. */
  readonly nudge: (turn: number, climb: number) => void
  /** Stand on a landing: its frame, where to stand, and what the blocks are. */
  readonly drop: (landing: Landing) => void
  /** Back into the glide, over the column walked to. */
  readonly takeOff: () => void
  /** What the stick and the look say this frame, from the walk controls. */
  readonly walk: (input: Partial<WalkInput>) => void
}

export interface Landing {
  readonly frame: Frame
  /** The row to stand on at the landing's middle. */
  readonly startY: number
  readonly stuff: StuffAt
  /** Whether the ground under a column is loaded yet; the walker waits for it. */
  readonly ready: (x: number, z: number) => boolean
}

export function createRig(clock: Clock, ground: () => Ground): Rig {
  let orbit: Orbit = INITIAL_ORBIT
  let glide: Glide | undefined
  let flight: Flight = ORBITING
  let last = clock.now()
  let landing: Landing | undefined
  let walker: Walker | undefined
  let input: WalkInput = STILL

  const view = (): CameraView => {
    const now = clock.now()
    const seconds = (now - last) / 1000
    last = now
    flight = settleFlight(flight, now)
    if (flight.mode === 'orbit') glide = undefined
    orbit = settle(orbit, seconds)
    if (walker !== undefined && landing !== undefined) {
      // Stand still until the ground under the feet is in: a step before it
      // arrives falls through the world.
      if (landing.ready(Math.floor(walker.x), Math.floor(walker.z))) {
        walker = stepWalker(walker, input, seconds, landing.stuff)
      }
      // The look deltas are spent; the stick and the jump are held.
      input = { ...input, turn: 0, tilt: 0 }
    } else if (glide !== undefined) {
      glide = advance(glide, seconds, ground())
    }
    return {
      orbit,
      surface: glide === undefined ? undefined : poseOf(glide),
      blend: blendOf(flight, now),
      walk: walker === undefined ? undefined : { ...eyeOf(walker), x: walker.x, z: walker.z },
    }
  }

  const gestures: GestureHandlers = {
    grab: () => {
      if (!steersGlide(flight)) orbit = grab(orbit)
    },
    drag: (dx, dy, seconds, height) => {
      if (walker !== undefined) return
      if (steersGlide(flight) && glide !== undefined) glide = steer(glide, dx, dy, height)
      else orbit = drag(orbit, dx, dy, seconds, height)
    },
    release: (sinceMove) => {
      if (!steersGlide(flight)) orbit = release(orbit, sinceMove)
    },
    pinch: (factor) => {
      if (walker !== undefined) return
      if (steersGlide(flight) && glide !== undefined) glide = pinchGlide(glide, factor)
      else orbit = pinch(orbit, factor)
    },
    wheel: (deltaY) => {
      if (walker !== undefined) return
      if (steersGlide(flight) && glide !== undefined)
        glide = pinchGlide(glide, Math.exp(-deltaY * 0.0015))
      else orbit = wheel(orbit, deltaY)
    },
  }

  const takeOff = (): void => {
    if (walker === undefined || landing === undefined) return
    const at = directionOf(landing.frame, walker.x - 0.5, walker.z - 0.5)
    const heading = directionOf(
      landing.frame,
      walker.x - 0.5 + Math.sin(walker.yaw) * 8,
      walker.z - 0.5 + Math.cos(walker.yaw) * 8,
    )
    glide = startGlide(at, [heading[0] - at[0], heading[1] - at[1], heading[2] - at[2]], ground())
    walker = undefined
    landing = undefined
    input = STILL
  }

  return {
    view,
    gestures,
    fly: (from) => {
      glide = startGlide(from.position, from.heading, ground())
      flight = dive(flight, clock.now())
    },
    land: (over) => {
      if (walker !== undefined) takeOff()
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
      walker = undefined
      landing = undefined
      input = STILL
    },
    flying: () => steersGlide(flight) && walker === undefined,
    walking: () => walker !== undefined,
    nudge: (turn, climb) => {
      if (glide !== undefined && walker === undefined && steersGlide(flight))
        glide = steer(glide, turn, climb, 1)
    },
    drop: (next) => {
      if (!steersGlide(flight)) return
      landing = next
      walker = standWalker(AREA / 2 + 0.5, next.startY, AREA / 2 + 0.5, 0)
      input = STILL
    },
    takeOff,
    walk: (next) => {
      input = {
        ...input,
        ...next,
        turn: input.turn + (next.turn ?? 0),
        tilt: input.tilt + (next.tilt ?? 0),
      }
    },
  }
}
