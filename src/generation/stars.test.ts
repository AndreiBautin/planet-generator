import { describe, expect, it } from 'vitest'

import { createRng } from './rng'
import { galaxyBand, starField } from './stars'

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

describe('galaxyBand', () => {
  const band = galaxyBand(createRng('abc2345'), 3000, 40)
  const at = (k: number): [number, number, number] => [
    band.positions[k * 3] ?? 0,
    band.positions[k * 3 + 1] ?? 0,
    band.positions[k * 3 + 2] ?? 0,
  ]

  it('lays its stars on the sky sphere, about a plane given by a unit normal', () => {
    expect(Math.hypot(...band.normal)).toBeCloseTo(1, 6)
    for (let k = 0; k < 3000; k += 1) expect(Math.hypot(...at(k))).toBeCloseTo(40, 2)
  })

  it('is a band: every star near its plane, most of them very near', () => {
    let near = 0
    for (let k = 0; k < 3000; k += 1) {
      const [x, y, z] = at(k)
      const off = Math.abs(
        Math.asin((x * band.normal[0] + y * band.normal[1] + z * band.normal[2]) / 40),
      )
      // The bell is the sum of three draws scaled by 0.16: never past 0.24.
      expect(off).toBeLessThanOrEqual(0.24 + 1e-6)
      if (off < 0.08) near += 1
    }
    expect(near / 3000).toBeGreaterThan(0.6)
  })

  it('is fainter than the field stars and the same for the same seed', () => {
    expect(Math.max(...band.colours)).toBeLessThan(0.08 * 1.05 + 0.45 * 1.05 + 1e-6)
    expect(galaxyBand(createRng('abc2345'), 3000, 40)).toEqual(band)
    expect(galaxyBand(createRng('zzz2345'), 3000, 40).normal).not.toEqual(band.normal)
  })
})
