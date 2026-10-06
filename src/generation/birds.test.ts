import { describe, expect, it } from 'vitest'

import { flockIn, MOST_BIRDS } from './birds'
import { FREEZES } from './features'
import { cellOf } from './hydrology'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

const CELLS = 6 * 128 * 128

describe('birds', () => {
  const world = planetOf('83tzj46')
  const flocks = Array.from({ length: CELLS / 37 }, (_, k) => flockIn(world, k * 37)).filter(
    (flock) => flock !== undefined,
  )

  it('keeps a flock over the same cell however it is asked for', () => {
    // A flock that changed between two looks would pop in and out of the sky.
    for (let cell = 0; cell < CELLS; cell += 997)
      expect(flockIn(world, cell)).toEqual(flockIn(world, cell))
  })

  it('puts each flock in its own cell, on both land and sea', () => {
    expect(flocks.some((flock) => flock.sea)).toBe(true)
    expect(flocks.some((flock) => !flock.sea)).toBe(true)
    for (let k = 0; k < CELLS; k += 37 * 50) {
      const flock = flockIn(world, k)
      if (flock !== undefined) expect(cellOf(flock.at)).toBe(k)
    }
  })

  it('flies only where it is warm enough, in flocks of a sensible size', () => {
    for (const flock of flocks) {
      const surface = surfaceAt(world, flock.at[0], flock.at[1], flock.at[2])
      expect(surface.warmth).toBeGreaterThan(FREEZES + 0.2)
      expect(surface.height < 0).toBe(flock.sea)
      expect(flock.birds).toBeGreaterThanOrEqual(5)
      expect(flock.birds).toBeLessThanOrEqual(MOST_BIRDS)
    }
  })

  it('leaves a molten world empty', () => {
    const molten = planetOf('h999999')
    for (let cell = 0; cell < CELLS; cell += 211) expect(flockIn(molten, cell)).toBeUndefined()
  })
})
