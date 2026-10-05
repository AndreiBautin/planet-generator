import { describe, expect, it } from 'vitest'

import { blendOf, dive, DIVE_MS, ORBITING, rise, RISE_MS, settleFlight } from './flight'

describe('flight', () => {
  it('dives from the orbit to the ground over its time, and then glides', () => {
    const diving = dive(ORBITING, 1000)
    expect(blendOf(diving, 1000)).toBe(0)
    expect(blendOf(diving, 1000 + DIVE_MS / 2)).toBeCloseTo(0.5, 5)
    expect(blendOf(diving, 1000 + DIVE_MS)).toBe(1)
    expect(settleFlight(diving, 1000 + DIVE_MS).mode).toBe('gliding')
    expect(settleFlight(diving, 1000 + DIVE_MS - 1).mode).toBe('diving')
  })

  it('rises back to the orbit, and then orbits', () => {
    const gliding = settleFlight(dive(ORBITING, 0), DIVE_MS)
    const rising = rise(gliding, 5000)
    expect(blendOf(rising, 5000)).toBe(1)
    expect(blendOf(rising, 5000 + RISE_MS)).toBe(0)
    expect(settleFlight(rising, 5000 + RISE_MS).mode).toBe('orbit')
  })

  it('turns back from wherever a dive had got to, rather than jumping', () => {
    const diving = dive(ORBITING, 0)
    const halfway = blendOf(diving, DIVE_MS / 2)
    const rising = rise(diving, DIVE_MS / 2)
    expect(blendOf(rising, DIVE_MS / 2)).toBeCloseTo(halfway, 10)
  })

  it('ignores a second press of the same way', () => {
    const diving = dive(ORBITING, 0)
    expect(dive(diving, 500)).toBe(diving)
    expect(rise(ORBITING, 500)).toBe(ORBITING)
  })
})
