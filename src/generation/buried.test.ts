import { describe, expect, it } from 'vitest'

import { cacheOf } from './cache'
import { surveyPlanet } from './landmarks'
import { createPlanet } from './planet'
import { parseSeed } from './seed'
import { AREA, blockAt, blockKey, CACHE_DEPTH, columnAt, columnOf, landingAt } from './voxel'

const seed = (text: string) => {
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error(`bad seed ${text}`)
  return parsed
}

describe('the cache in the ground', () => {
  it('is cut under the ground of a landing that holds it, and nowhere else', () => {
    const planet = createPlanet(seed('crq59r7'))
    const cache = cacheOf(planet, surveyPlanet(planet))
    const landing = landingAt(planet, cache.direction, cache.direction)
    const [cx, cz] = columnOf(landing, cache.direction)
    const x = Math.round(cx)
    const z = Math.round(cz)
    expect(Math.abs(x - AREA / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(z - AREA / 2)).toBeLessThanOrEqual(1)
    const column = columnAt(landing, x, z)
    const heart = column.ground - CACHE_DEPTH
    expect(blockAt(landing, x, z, column, heart)).toBe('cache')
    expect(blockAt(landing, x, z, column, heart + 1)).toBe('air')
    expect(blockAt(landing, x, z, column, heart + 2)).not.toBe('air')
    expect(blockAt(landing, x, z, column, column.ground)).not.toBe('air')
    expect(landing.buried.get(blockKey(x, heart, z))).toBe('cache')
    expect(landing.buried.size).toBe(27)

    // A landing elsewhere on the planet buries nothing.
    const elsewhere = landingAt(
      planet,
      [-cache.direction[0], -cache.direction[1], -cache.direction[2]],
      cache.direction,
    )
    expect(elsewhere.buried.size).toBe(0)
    const bare = landingAt(planet, cache.direction)
    expect(bare.buried.size).toBe(0)
  })
})
