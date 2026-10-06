import { describe, expect, it } from 'vitest'

import { ECLIPSE_FLOOR, moonLight, moonShadow } from './eclipse'

const SUN: [number, number, number] = [1, 0, 0]

describe('eclipses', () => {
  const ground: [number, number, number] = [1, 0, 0]

  it('darkens the ground under a moon between it and the sun', () => {
    const moon = [4.5, 0, 0, 0.25] as const
    expect(moonShadow(ground, SUN, [moon])).toBeCloseTo(1 - ECLIPSE_FLOOR, 5)
  })

  it('leaves the ground lit with the moon behind it, or off to one side', () => {
    expect(moonShadow(ground, SUN, [[-4.5, 0, 0, 0.25]])).toBe(0)
    expect(moonShadow(ground, SUN, [[4.5, 1, 0, 0.25]])).toBe(0)
    // A moon of radius nought is no moon.
    expect(moonShadow(ground, SUN, [[4.5, 0, 0, 0]])).toBe(0)
  })

  it('softens the edge rather than cutting it', () => {
    // Just outside the moon's own radius the sun is part hidden, not whole.
    const edge = moonShadow(ground, SUN, [[4.5, 0.26, 0, 0.25]])
    expect(edge).toBeGreaterThan(0.05)
    expect(edge).toBeLessThan(0.9)
  })

  it("reddens a moon only in the planet's shadow", () => {
    expect(moonLight([5, 0, 0], SUN)).toBe(1)
    expect(moonLight([-5, 0, 0], SUN)).toBe(0)
    expect(moonLight([-5, 2, 0], SUN)).toBe(1)
    expect(moonLight([0, 5, 0], SUN)).toBe(1)
  })
})
