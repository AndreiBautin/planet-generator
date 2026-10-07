import { describe, expect, it } from 'vitest'

import { harboursOf } from './harbours'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('harbours', () => {
  const world = planetOf('83tzj46')
  const { harbours, lanes } = harboursOf(world)
  const sea = (d: readonly [number, number, number]): boolean =>
    surfaceAt(world, d[0], d[1], d[2]).height < 0

  it('puts each on a shore, land behind it and open sea at its mouth', () => {
    expect(harbours.length).toBeGreaterThan(5)
    for (const harbour of harbours) {
      expect(sea(harbour.shore)).toBe(false)
      expect(sea(harbour.mouth)).toBe(true)
      // Out to sea is along the ground, not up out of it.
      const up = harbour.shore
      expect(
        Math.abs(up[0] * harbour.out[0] + up[1] * harbour.out[1] + up[2] * harbour.out[2]),
      ).toBeLessThan(1e-9)
    }
  })

  it('sails its lanes over open water only', () => {
    // A ship sailing across land would be the first thing a glide saw.
    expect(lanes.length).toBeGreaterThan(3)
    for (const lane of lanes) for (const point of lane) expect(sea(point)).toBe(true)
  })

  it('has none on an unsettled world', () => {
    expect(harboursOf(planetOf('h999999')).harbours).toEqual([])
  })
})
