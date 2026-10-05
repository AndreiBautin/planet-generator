import { describe, expect, it } from 'vitest'

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
} from './orbit'

const flick = () => release(drag(grab(INITIAL_ORBIT), -100, 0, 1 / 60, 800), 0.01)

describe('orbit', () => {
  it('turns the camera with a drag, the same way as the finger', () => {
    const moved = drag(grab(INITIAL_ORBIT), -200, 0, 0.1, 800)
    // Dragging left brings the ground on the right into view.
    expect(moved.yaw).toBeGreaterThan(INITIAL_ORBIT.yaw)
    expect(moved.pitch).toBe(INITIAL_ORBIT.pitch)
  })

  it('turns less for the same drag when closer in', () => {
    const far = drag(grab(INITIAL_ORBIT), -100, 0, 0.1, 800)
    const near = drag(grab({ ...INITIAL_ORBIT, distance: 2 }), -100, 0, 0.1, 800)
    expect(Math.abs(near.yaw)).toBeLessThan(Math.abs(far.yaw))
  })

  it('stops short of the poles however far it is dragged', () => {
    const over = drag(grab(INITIAL_ORBIT), 0, 100_000, 0.1, 800)
    const under = drag(grab(INITIAL_ORBIT), 0, -100_000, 0.1, 800)
    expect(over.pitch).toBe(MAX_PITCH)
    expect(under.pitch).toBe(-MAX_PITCH)
  })

  it('keeps coasting after a flick, and slows to a stop', () => {
    const thrown = flick()
    const soon = settle(thrown, 0.2)
    expect(soon.yaw).toBeGreaterThan(thrown.yaw)
    let later = soon
    for (let at = 0; at < 600; at += 1) later = settle(later, 1 / 60)
    expect(later.yawVelocity).toBe(0)
    const still = settle(later, 1)
    expect(still.yaw).toBe(later.yaw)
  })

  it('coasts the same distance in one long frame as in many short ones', () => {
    const thrown = flick()
    const once = settle(thrown, 0.5)
    let stepped = thrown
    for (let at = 0; at < 30; at += 1) stepped = settle(stepped, 0.5 / 30)
    expect(stepped.yaw).toBeCloseTo(once.yaw, 6)
  })

  it('does not fling a finger that stopped before it lifted', () => {
    const paused = release(drag(grab(INITIAL_ORBIT), -100, 0, 1 / 60, 800), 0.3)
    expect(paused.yawVelocity).toBe(0)
  })

  it('stops a coast the moment a finger lands on it', () => {
    expect(grab(flick()).yawVelocity).toBe(0)
  })

  it('does not coast while held', () => {
    const held = drag(grab(INITIAL_ORBIT), -100, 0, 1 / 60, 800)
    expect(settle(held, 0.5)).toBe(held)
  })

  it('moves in on a spread and out on a squeeze, within limits', () => {
    expect(pinch(INITIAL_ORBIT, 1.5).distance).toBeLessThan(INITIAL_ORBIT.distance)
    expect(pinch(INITIAL_ORBIT, 0.5).distance).toBeGreaterThan(INITIAL_ORBIT.distance)
    expect(pinch(INITIAL_ORBIT, 1000).distance).toBe(MIN_DISTANCE)
    expect(pinch(INITIAL_ORBIT, 0.001).distance).toBe(MAX_DISTANCE)
  })

  it('ignores a pinch it cannot measure', () => {
    expect(pinch(INITIAL_ORBIT, 0)).toBe(INITIAL_ORBIT)
    expect(pinch(INITIAL_ORBIT, Number.NaN)).toBe(INITIAL_ORBIT)
  })

  it('moves away on a wheel scrolled down', () => {
    expect(wheel(INITIAL_ORBIT, 100).distance).toBeGreaterThan(INITIAL_ORBIT.distance)
    expect(wheel(INITIAL_ORBIT, -100).distance).toBeLessThan(INITIAL_ORBIT.distance)
  })
})
