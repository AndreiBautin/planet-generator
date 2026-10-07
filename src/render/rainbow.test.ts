import { describe, expect, it } from 'vitest'

import { rainbowStrength, type RainbowSky } from './rainbow'

const showers: RainbowSky = { sunUp: 0.25, height: 0.004, rainAway: 0.9, cloudOver: 0.1 }

describe('rainbowStrength', () => {
  it('shines with a low sun behind and rain ahead', () => {
    expect(rainbowStrength(showers)).toBeGreaterThan(0.8)
  })

  it('needs every condition', () => {
    // Higher than the bow is wide, the bow is under the horizon; at night there is no sun.
    expect(rainbowStrength({ ...showers, sunUp: 0.6 })).toBe(0)
    expect(rainbowStrength({ ...showers, sunUp: -0.1 })).toBe(0)
    // No rain to make it, or no sun on it under the cloud overhead.
    expect(rainbowStrength({ ...showers, rainAway: 0.2 })).toBe(0)
    expect(rainbowStrength({ ...showers, cloudOver: 0.9 })).toBe(0)
    // From high up a rainbow is a ring nobody sees from a plane window.
    expect(rainbowStrength({ ...showers, height: 0.2 })).toBe(0)
  })
})
