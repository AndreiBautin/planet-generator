import { describe, expect, it } from 'vitest'

import { BIRTH_SECONDS, birthAt, BORN } from './birth'

describe('birthAt', () => {
  it('starts as a small ball with no clouds or air', () => {
    const start = birthAt(0)
    expect(start.scale).toBeCloseTo(0.3, 5)
    expect(start.clouds).toBe(0)
    expect(start.air).toBe(0)
  })

  it('lands exactly on the finished planet, and stays there', () => {
    expect(birthAt(BIRTH_SECONDS)).toBe(BORN)
    expect(birthAt(60)).toBe(BORN)
  })

  it('treats a time it cannot read as finished rather than stuck', () => {
    expect(birthAt(Number.NaN)).toBe(BORN)
  })

  it('overshoots a little and settles, rather than snapping', () => {
    let peak = 0
    for (let t = 0; t < BIRTH_SECONDS; t += 0.01) peak = Math.max(peak, birthAt(t).scale)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.15)
    expect(birthAt(BIRTH_SECONDS - 0.001).scale).toBeCloseTo(1, 3)
  })

  it('never thins the clouds or the air once they are gathering', () => {
    let clouds = 0
    let air = 0
    for (let t = 0; t <= BIRTH_SECONDS; t += 0.02) {
      const now = birthAt(t)
      expect(now.clouds).toBeGreaterThanOrEqual(clouds)
      expect(now.air).toBeGreaterThanOrEqual(air)
      clouds = now.clouds
      air = now.air
    }
  })
})
