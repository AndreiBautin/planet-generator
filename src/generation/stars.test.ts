import { describe, expect, it } from 'vitest'

import { createRng } from './rng'
import { starField } from './stars'

describe('starField', () => {
  it('puts every star on the sphere it was asked for', () => {
    const { positions } = starField(createRng('abc2345'), 500, 50)
    for (let at = 0; at < 500; at += 1) {
      const length = Math.hypot(
        positions[at * 3] ?? 0,
        positions[at * 3 + 1] ?? 0,
        positions[at * 3 + 2] ?? 0,
      )
      expect(length).toBeCloseTo(50, 3)
    }
  })

  it('spreads stars evenly rather than bunching them at the poles', () => {
    const count = 4000
    const { positions } = starField(createRng('abc2345'), count, 1)
    // On a uniform sphere a band |z| < 0.5 holds exactly half the area.
    let band = 0
    for (let at = 0; at < count; at += 1) if (Math.abs(positions[at * 3 + 2] ?? 0) < 0.5) band += 1
    expect(band / count).toBeGreaterThan(0.46)
    expect(band / count).toBeLessThan(0.54)
  })

  it('gives the same sky for the same seed', () => {
    const a = starField(createRng('abc2345'), 50, 10)
    const b = starField(createRng('abc2345'), 50, 10)
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
    expect(Array.from(a.colours)).toEqual(Array.from(b.colours))
  })

  it('keeps most stars faint', () => {
    const count = 2000
    const { colours } = starField(createRng('abc2345'), count, 1)
    let bright = 0
    for (let at = 0; at < count; at += 1) if ((colours[at * 3 + 1] ?? 0) > 0.6) bright += 1
    expect(bright / count).toBeLessThan(0.25)
  })
})
