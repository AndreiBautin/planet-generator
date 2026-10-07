import { describe, expect, it } from 'vitest'

import { FREEZES } from './features'
import { schoolIn } from './fish'
import { forestIn, KELP_WARMEST } from './kelp'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

const CELLS = 6 * 128 * 128

describe('kelp', () => {
  const world = planetOf('83tzj46')
  const forests = Array.from({ length: CELLS / 37 }, (_, k) => forestIn(world, k * 37)).filter(
    (forest) => forest !== undefined,
  )

  it('grows in the cool open sea, where coral does not', () => {
    // Too warm and it would stand in the reefs; too cold and under the ice.
    expect(forests.length).toBeGreaterThan(20)
    for (const forest of forests) {
      const surface = surfaceAt(world, forest.at[0], forest.at[1], forest.at[2])
      expect(surface.height).toBeLessThan(0)
      expect(surface.warmth).toBeLessThanOrEqual(KELP_WARMEST)
      expect(surface.warmth).toBeGreaterThan(FREEZES + 0.2)
    }
  })

  it('stays where it grows however it is asked for', () => {
    for (let cell = 0; cell < CELLS; cell += 1013)
      expect(forestIn(world, cell)).toEqual(forestIn(world, cell))
  })

  it('is decided apart from the fish in the same water', () => {
    let both = 0
    let forested = 0
    for (let cell = 0; cell < CELLS; cell += 37) {
      if (forestIn(world, cell) === undefined) continue
      forested += 1
      if (schoolIn(world, cell) !== undefined) both += 1
    }
    expect(both).toBeLessThan(forested)
  })

  it('leaves a molten world bare', () => {
    const molten = planetOf('h999999')
    for (let cell = 0; cell < CELLS; cell += 211) expect(forestIn(molten, cell)).toBeUndefined()
  })
})
