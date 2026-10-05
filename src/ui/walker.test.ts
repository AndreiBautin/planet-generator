import { describe, expect, it } from 'vitest'

import { eyeOf, standWalker, stepWalker, STILL, type StuffAt } from './walker'

/** A flat floor at y < 0, a wall at x = 5, a one-block step at z = 5, a pool at z > 10. */
const ground: StuffAt = (x, y, z) => {
  if (z > 10) return y < 0 ? 'solid' : y < 3 ? 'liquid' : 'air'
  if (y < 0) return 'solid'
  if (x === 5 && y < 3) return 'solid'
  if (z === 5 && y < 1) return 'solid'
  return 'air'
}

const run = (
  from: ReturnType<typeof standWalker>,
  input: typeof STILL,
  frames: number,
): ReturnType<typeof standWalker> => {
  let walker = from
  for (let at = 0; at < frames; at += 1) walker = stepWalker(walker, input, 1 / 60, ground)
  return walker
}

describe('walking', () => {
  it('falls onto the ground and stands there', () => {
    const landed = run(standWalker(1, 5, 1), STILL, 120)
    expect(landed.y).toBeCloseTo(0, 6)
    expect(landed.onGround).toBe(true)
    expect(landed.vy).toBe(0)
  })

  it('walks forward the way it faces, and strafes to the side', () => {
    const start = run(standWalker(1, 0, 1), STILL, 5)
    const ahead = run(start, { ...STILL, forward: 1 }, 60)
    expect(ahead.z).toBeGreaterThan(start.z + 3)
    expect(Math.abs(ahead.x - start.x)).toBeLessThan(0.01)
    const right = run(start, { ...STILL, strafe: 1 }, 60)
    expect(right.x).toBeGreaterThan(start.x + 3)
  })

  it('is stopped by a wall and slides along it', () => {
    const start = run(standWalker(3, 0, 1), STILL, 5)
    const pushed = run(start, { ...STILL, forward: 0.3, strafe: 1 }, 120)
    expect(pushed.x).toBeLessThan(5 - 0.3 + 0.01)
    expect(pushed.z).toBeGreaterThan(start.z + 1)
  })

  it('steps up a single block without a jump', () => {
    const start = run(standWalker(1, 0, 3), STILL, 5)
    const over = run(start, { ...STILL, forward: 1 }, 90)
    expect(over.z).toBeGreaterThan(6)
    expect(over.y).toBeGreaterThanOrEqual(0)
  })

  it('jumps from the ground and comes back down', () => {
    const start = run(standWalker(1, 0, 1), STILL, 5)
    const up = run(start, { ...STILL, jump: true }, 10)
    expect(up.y).toBeGreaterThan(0.5)
    const down = run(up, STILL, 120)
    expect(down.y).toBeCloseTo(0, 6)
  })

  it('swims rather than sinking like a stone, and rises on jump', () => {
    const swimmer = run(standWalker(1, 2, 12), STILL, 60)
    expect(swimmer.swimming).toBe(true)
    expect(swimmer.y).toBeGreaterThan(0)
    const risen = run(swimmer, { ...STILL, jump: true }, 30)
    expect(risen.y).toBeGreaterThan(swimmer.y)
  })

  it('turns and tilts the eyes, within limits', () => {
    const turned = stepWalker(standWalker(0, 0, 0), { ...STILL, turn: Math.PI / 2 }, 1 / 60, ground)
    expect(eyeOf(turned).forward[0]).toBeCloseTo(1, 1)
    const tilted = stepWalker(standWalker(0, 0, 0), { ...STILL, tilt: 10 }, 1 / 60, ground)
    expect(tilted.pitch).toBeLessThan(Math.PI / 2)
    expect(eyeOf(tilted).eye[1]).toBeCloseTo(1.6, 6)
  })
})
