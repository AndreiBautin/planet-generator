import { describe, expect, it } from 'vitest'

import { fixedClock } from '@/app/clock'
import { SEA_RADIUS } from '@/render/water'

import { createRig } from './rig'

/** Fly the rig for `seconds`, a frame at a time; the eye's distance from the centre at each frame. */
function flyFor(
  rig: ReturnType<typeof createRig>,
  clock: ReturnType<typeof fixedClock>,
  seconds: number,
): number[] {
  const eyes: number[] = []
  for (let t = 0; t < seconds; t += 1 / 30) {
    clock.advance(1000 / 30)
    const eye = rig.view().surface?.eye
    if (eye !== undefined) eyes.push(Math.hypot(...eye))
  }
  return eyes
}

describe('under the sea', () => {
  const start = (): {
    rig: ReturnType<typeof createRig>
    clock: ReturnType<typeof fixedClock>
  } => {
    const clock = fixedClock(0)
    // Sea everywhere: the surface is the ground the air flies over.
    const rig = createRig(clock, () => () => SEA_RADIUS)
    rig.fly({ position: [0, 0, 1], heading: [1, 0, 0] })
    flyFor(rig, clock, 3)
    return { rig, clock }
  }

  it('goes under deep water and stays under the surface', () => {
    const { rig, clock } = start()
    expect(rig.submerge(() => SEA_RADIUS - 0.015)).toBe(true)
    const eyes = flyFor(rig, clock, 4)
    expect(eyes.at(-1) ?? 2).toBeLessThan(SEA_RADIUS)
    expect(eyes.at(-1) ?? 0).toBeGreaterThan(SEA_RADIUS - 0.015)
  })

  it('will not dive into a lagoon', () => {
    const { rig } = start()
    expect(rig.submerge(() => SEA_RADIUS - 0.002)).toBe(false)
    expect(rig.submerged()).toBe(false)
  })

  it('dives into a warm sea, where the reefs are', () => {
    // Warm seas run 0.006 to 0.008 deep; refusing them hid the coral from below.
    const { rig } = start()
    expect(rig.submerge(() => SEA_RADIUS - 0.0065)).toBe(true)
  })

  it('comes up by itself where the water grows shallow, and says so', () => {
    const { rig, clock } = start()
    let depth = 0.015
    rig.submerge(() => SEA_RADIUS - depth)
    flyFor(rig, clock, 3)
    const told: boolean[] = []
    rig.onSurface((shallow) => told.push(shallow))
    depth = 0.002
    const eyes = flyFor(rig, clock, 4)
    expect(rig.submerged()).toBe(false)
    expect(told).toEqual([true])
    // Up into the air again, not left under the surface.
    expect(eyes.at(-1) ?? 0).toBeGreaterThan(SEA_RADIUS)
  })

  it('crosses the surface without a jump, either way', () => {
    const { rig, clock } = start()
    const before = flyFor(rig, clock, 0.1)
    rig.submerge(() => SEA_RADIUS - 0.015)
    const down = [...before.slice(-1), ...flyFor(rig, clock, 4)]
    rig.submerge(undefined)
    const up = [...down.slice(-1), ...flyFor(rig, clock, 4)]
    const steps = [...down, ...up]
      .slice(1)
      .map((eye, k) => Math.abs(eye - ([...down, ...up][k] ?? eye)))
    // A frame's settling, never a leap through the surface (about 0.01).
    expect(Math.max(...steps)).toBeLessThan(0.003)
  })
})

describe('the rig between orbit and flight', () => {
  const GROUND = 1.01
  const start = (): {
    rig: ReturnType<typeof createRig>
    clock: ReturnType<typeof fixedClock>
  } => {
    const clock = fixedClock(0)
    return { rig: createRig(clock, () => () => GROUND), clock }
  }
  const over = (): { yaw: number; pitch: number } => ({ yaw: 0.3, pitch: 0.2 })

  it('flies after Fly and is back in orbit once it has landed', () => {
    const { rig, clock } = start()
    expect(rig.flying()).toBe(false)
    expect(rig.height().kind).toBe('orbit')
    rig.fly({ position: [0, 0, 1], heading: [1, 0, 0] })
    flyFor(rig, clock, 4)
    expect(rig.flying()).toBe(true)
    expect(rig.height().kind).toBe('glide')
    expect(rig.viewpoint()).toBeDefined()
    rig.land(over)
    expect(rig.flying()).toBe(false)
    flyFor(rig, clock, 6)
    expect(rig.view().blend).toBe(0)
    expect(rig.viewpoint()).toBeUndefined()
  })

  it('holds a dive as a glide at once, and drops a rise straight to the orbit', () => {
    const diving = start()
    diving.rig.fly({ position: [0, 0, 1], heading: [1, 0, 0] })
    diving.rig.hold('frame')
    expect(diving.rig.flying()).toBe(true)
    expect(diving.rig.view().blend).toBe(1)

    const rising = start()
    rising.rig.fly({ position: [0, 0, 1], heading: [1, 0, 0] })
    flyFor(rising.rig, rising.clock, 4)
    rising.rig.land(over)
    rising.rig.hold('frame')
    expect(rising.rig.view().blend).toBe(0)
    expect(rising.rig.viewpoint()).toBeUndefined()
  })

  it('places a held glide with its eye exactly the asked height over the ground', () => {
    // What lets a shot link reproduce the picture (postcard.ts).
    const { rig } = start()
    rig.hold('still')
    rig.place({ kind: 'glide', position: [0, 1, 0], heading: [1, 0, 0], altitude: 0.02, tilt: 0.1 })
    const eye = rig.view().surface?.eye
    expect(eye).toBeDefined()
    expect(Math.hypot(...(eye ?? [0, 0, 0]))).toBeCloseTo(GROUND + 0.02, 9)
    expect(rig.viewpoint()?.tilt).toBeCloseTo(0.1, 9)
  })

  it('keeps an orbit placed or set within its distances', () => {
    const { rig } = start()
    rig.place({ kind: 'orbit', yaw: 0, pitch: 9, distance: 99 })
    expect(rig.height().value).toBe(6)
    rig.setHeight(0.5)
    expect(rig.height().value).toBe(1.9)
  })

  it('opens the system only on a deliberate push past the farthest orbit', () => {
    const { rig } = start()
    let opened = 0
    rig.onBeyond(() => (opened += 1))
    rig.gestures.wheel(400)
    expect(opened).toBe(0)
    rig.setHeight(6)
    rig.gestures.wheel(200)
    expect(opened).toBe(0)
    rig.gestures.wheel(300)
    expect(opened).toBe(1)
  })

  it('stops the tour when a hand takes over, and cut drops everything', () => {
    const { rig, clock } = start()
    const said: boolean[] = []
    rig.onTour((on) => said.push(on))
    rig.fly({ position: [0, 0, 1], heading: [1, 0, 0] })
    flyFor(rig, clock, 4)
    rig.tour(true)
    expect(rig.touring()).toBe(true)
    rig.nudge(0.04, 0)
    expect(rig.touring()).toBe(false)
    expect(said).toEqual([true, false])
    rig.cut()
    expect(rig.flying()).toBe(false)
    expect(rig.view().blend).toBe(0)
  })
})
