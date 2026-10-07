import { describe, expect, it } from 'vitest'

import { flockIn } from './birds'
import { featuresAt } from './features'
import { herdIn, MOST_BEASTS } from './herds'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

const CELLS = 6 * 128 * 128

describe('herds', () => {
  const world = planetOf('83tzj46')
  const herds = Array.from({ length: CELLS / 29 }, (_, k) => herdIn(world, k * 29)).filter(
    (herd) => herd !== undefined,
  )

  it('graze open land, out of the woods and off the sea, shore and snow', () => {
    // A herd in the trees would stand inside them; one on the beach, in the sea.
    expect(herds.length).toBeGreaterThan(30)
    for (const herd of herds) {
      const surface = surfaceAt(world, herd.at[0], herd.at[1], herd.at[2])
      expect(surface.biome).toBe('land')
      const growth = featuresAt(world, surface, 0)
      expect(growth.broadleaf + growth.conifer).toBeLessThanOrEqual(0.4)
      expect(herd.beasts).toBeLessThanOrEqual(MOST_BEASTS)
    }
  })

  it('come in more than one kind on a varied world', () => {
    expect(new Set(herds.map((herd) => herd.kind)).size).toBeGreaterThan(1)
  })

  it('keep to their ground however they are asked for', () => {
    for (let cell = 0; cell < CELLS; cell += 1013)
      expect(herdIn(world, cell)).toEqual(herdIn(world, cell))
  })

  it('are decided apart from the birds over the same ground', () => {
    let both = 0
    let herded = 0
    for (let cell = 0; cell < CELLS; cell += 29) {
      if (herdIn(world, cell) === undefined) continue
      herded += 1
      if (flockIn(world, cell) !== undefined) both += 1
    }
    expect(both).toBeLessThan(herded)
  })

  it('leave a molten world empty', () => {
    const molten = planetOf('h999999')
    for (let cell = 0; cell < CELLS; cell += 211) expect(herdIn(molten, cell)).toBeUndefined()
  })
})
