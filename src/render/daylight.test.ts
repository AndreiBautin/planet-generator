import { describe, expect, it } from 'vitest'

import { daylightAt } from './daylight'

describe('daylightAt', () => {
  const low = 0.01

  it('dims from noon through dusk to night, never brightening on the way', () => {
    let last = daylightAt(1, low)
    for (let elevation = 0.95; elevation >= -0.4; elevation -= 0.05) {
      const now = daylightAt(elevation, low)
      expect(now.day).toBeLessThanOrEqual(last.day)
      expect(now.twilight).toBeLessThanOrEqual(last.twilight)
      expect(now.starsSeen).toBeGreaterThanOrEqual(last.starsSeen)
      last = now
    }
    expect(daylightAt(1, low).day).toBe(1)
    expect(daylightAt(-0.4, low).twilight).toBe(0)
  })

  it('keeps the sky lit after the sun has set: twilight outlasts the day', () => {
    const justSet = daylightAt(-0.1, low)
    expect(justSet.day).toBeLessThan(0.1)
    expect(justSet.twilight).toBeGreaterThan(0.2)
    // The ground is seen by the sky then, so it gets more of the sky's light than at noon's share.
    expect(daylightAt(0, low).skylight).toBeGreaterThan(daylightAt(1, low).skylight)
  })

  it('shows no stars by day low down, all of them from orbit, all of them at night', () => {
    expect(daylightAt(0.8, low).starsSeen).toBeCloseTo(0.05, 6)
    expect(daylightAt(0.8, 2).starsSeen).toBe(1)
    expect(daylightAt(-0.5, low).starsSeen).toBe(1)
  })

  it('thickens the haze lower down and has none from orbit', () => {
    expect(daylightAt(0.5, 0.005).fogDensity).toBeGreaterThan(daylightAt(0.5, 0.05).fogDensity)
    expect(daylightAt(0.5, 2).fogDensity).toBe(0)
    expect(Number.isFinite(daylightAt(0.5, 0).fogDensity)).toBe(true)
  })
})
