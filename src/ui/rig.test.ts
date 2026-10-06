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
