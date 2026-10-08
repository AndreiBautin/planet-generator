import { describe, expect, it } from 'vitest'

import { SWELL_FAR, SWELL_TRAINS, SWELL_TRAINS_GLSL, swellHeaveAt } from './swell'
import { SEA_RADIUS } from './water'

describe('the swell', () => {
  const at = [0.3 * SEA_RADIUS, 0.4 * SEA_RADIUS, Math.sqrt(1 - 0.25) * SEA_RADIUS] as const
  const above = [at[0] * 1.004, at[1] * 1.004, at[2] * 1.004] as const

  it('stays short of folding: the trains’ steepness, pushed sideways and shoaled, under one', () => {
    const steepness = SWELL_TRAINS.reduce((sum, train) => sum + train[2], 0)
    expect(steepness * 0.8 * 1.7).toBeLessThan(1)
  })

  it('heaves no further than its trains’ amplitudes add up to, and does heave', () => {
    const most = SWELL_TRAINS.reduce(
      (sum, [, wavelength, steepness]) => sum + (steepness * wavelength) / (Math.PI * 2),
      0,
    )
    let biggest = 0
    for (let t = 0; t < 30; t += 0.37) {
      const heave = swellHeaveAt(at, t, above)
      expect(Math.abs(heave)).toBeLessThanOrEqual(most + 1e-12)
      biggest = Math.max(biggest, Math.abs(heave))
    }
    // Taller than a hull, which is why a ship has to ride it.
    expect(biggest).toBeGreaterThan(0.0001)
  })

  it('stands taller in the shallows and still at the shore, as the water draws it', () => {
    let deep = 0
    let shallow = 0
    for (let t = 0; t < 30; t += 0.37) {
      deep = Math.max(deep, Math.abs(swellHeaveAt(at, t, above)))
      shallow = Math.max(shallow, Math.abs(swellHeaveAt(at, t, above, 0.001)))
      expect(swellHeaveAt(at, t, above, 0)).toBe(0)
    }
    expect(shallow).toBeGreaterThan(deep * 1.3)
    expect(shallow).toBeLessThan(deep * 1.7 + 1e-12)
  })

  it('lies still beyond where the water stops drawing it', () => {
    const far = [
      at[0] * (1 + SWELL_FAR * 2),
      at[1] * (1 + SWELL_FAR * 2),
      at[2] * (1 + SWELL_FAR * 2),
    ] as const
    expect(swellHeaveAt(at, 3, far)).toBe(0)
  })

  it('hands the shader the same trains', () => {
    for (const train of SWELL_TRAINS) expect(SWELL_TRAINS_GLSL).toContain(String(train[1]))
    expect(SWELL_TRAINS_GLSL).toContain(`vec4 trains[${String(SWELL_TRAINS.length)}]`)
  })
})
