import { describe, expect, it } from 'vitest'

import { sunbeamStrength } from './sunbeams'

describe('sunbeams', () => {
  it('are strongest with the sun low, in view, seen from near the ground', () => {
    const low = sunbeamStrength(0.1, 1, 0)
    expect(low).toBeGreaterThan(0.9)
    expect(sunbeamStrength(0.9, 1, 0)).toBeLessThan(low * 0.5)
  })

  it('are gone once the sun is down, from orbit, and with the sun far off the screen', () => {
    expect(sunbeamStrength(-0.1, 1, 0)).toBe(0)
    expect(sunbeamStrength(0.1, 0, 0)).toBe(0)
    expect(sunbeamStrength(0.1, 1, 1.5)).toBe(0)
  })
})
