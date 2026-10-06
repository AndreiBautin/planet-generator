import { describe, expect, it } from 'vitest'

import { mixFor, thunderFrom } from './sound'

const calm = { speed: 0, above: 0.016, coast: 0, rain: 0 }

describe('mixFor', () => {
  it('blows harder and higher the faster the eye goes', () => {
    const slow = mixFor({ ...calm, speed: 0.002 })
    const fast = mixFor({ ...calm, speed: 0.02 })
    expect(fast.wind).toBeGreaterThan(slow.wind)
    expect(fast.windPitch).toBeGreaterThan(slow.windPitch)
  })

  it('is silent in orbit, whatever is happening below', () => {
    const orbit = mixFor({ speed: 0.05, above: 2, coast: 1, rain: 1 })
    expect(orbit.wind).toBe(0)
    expect(orbit.surf).toBe(0)
    expect(orbit.rain).toBe(0)
  })

  it('hears the surf only low over a coast', () => {
    expect(mixFor({ ...calm, coast: 1, above: 0.004 }).surf).toBeGreaterThan(0.4)
    expect(mixFor({ ...calm, coast: 0, above: 0.004 }).surf).toBe(0)
    expect(mixFor({ ...calm, coast: 1, above: 0.06 }).surf).toBe(0)
  })
})

describe('thunderFrom', () => {
  it('arrives later and quieter the further off it struck, and not at all from far away', () => {
    const near = thunderFrom(0.01)
    const far = thunderFrom(0.1)
    expect(far.delay).toBeGreaterThan(near.delay)
    expect(far.loudness).toBeLessThan(near.loudness)
    expect(thunderFrom(0.3).loudness).toBe(0)
  })
})
