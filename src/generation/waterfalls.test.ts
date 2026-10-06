import { describe, expect, it } from 'vitest'

import { FREEZES } from './features'
import { hydrologyOf, waterAt } from './hydrology'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'
import { MOST_FALLS, waterfallsOf } from './waterfalls'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('waterfalls', () => {
  const world = planetOf('83tzj46')

  it('falls only where there is water to fall', () => {
    expect(planetOf('h999999').molten).toBe(true)
    expect(waterfallsOf(planetOf('h999999'))).toEqual([])
  })

  it('puts every fall on a river as it is drawn, and not on snow', () => {
    const falls = waterfallsOf(world)
    expect(falls.length).toBeGreaterThan(3)
    expect(falls.length).toBeLessThanOrEqual(MOST_FALLS)
    const water = hydrologyOf(world)
    const near = new Map<number, readonly number[]>()
    for (const { at, drop } of falls) {
      // Spray off the channel would hang in the air over a dry hillside.
      expect(waterAt(world, water, at, near).river).toBeGreaterThan(0.6)
      const surface = surfaceAt(world, at[0], at[1], at[2])
      expect(surface.biome).not.toBe('snow')
      // Nor where the water ices over: a frozen fall throws no spray.
      expect(surface.warmth).toBeGreaterThan(FREEZES + 0.2)
      expect(drop).toBeGreaterThan(0)
      expect(drop).toBeLessThanOrEqual(1)
    }
  })

  it('keeps them apart', () => {
    const falls = waterfallsOf(world)
    for (let a = 0; a < falls.length; a += 1)
      for (let b = a + 1; b < falls.length; b += 1) {
        const p = falls[a]?.at ?? [0, 0, 1]
        const q = falls[b]?.at ?? [0, 0, 1]
        expect(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]).toBeLessThan(Math.cos(0.03))
      }
  })
})
