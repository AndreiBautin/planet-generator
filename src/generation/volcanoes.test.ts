import { describe, expect, it } from 'vitest'

import { cellOf, hydrologyOf, neighboursOf } from './hydrology'
import { createPlanet } from './planet'
import { parseSeed } from './seed'
import { MOST_VOLCANOES, volcanoesOf } from './volcanoes'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('volcanoes', () => {
  const molten = planetOf('h999999')

  it('smokes only on a molten world', () => {
    expect(molten.molten).toBe(true)
    expect(volcanoesOf(planetOf('83tzj46'))).toEqual([])
  })

  it('puts each on a summit, higher than all the ground round it', () => {
    const { height } = hydrologyOf(molten)
    const volcanoes = volcanoesOf(molten)
    expect(volcanoes.length).toBeGreaterThan(3)
    expect(volcanoes.length).toBeLessThanOrEqual(MOST_VOLCANOES)
    for (const { at } of volcanoes) {
      const cell = cellOf(at)
      for (const next of neighboursOf(cell))
        expect(height[next] ?? 0).toBeLessThan(height[cell] ?? 0)
    }
  })

  it('keeps them apart, the tallest hottest', () => {
    const volcanoes = volcanoesOf(molten)
    for (let i = 0; i < volcanoes.length; i += 1) {
      for (let j = i + 1; j < volcanoes.length; j += 1) {
        const a = volcanoes[i]?.at ?? [1, 0, 0]
        const b = volcanoes[j]?.at ?? [1, 0, 0]
        expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeLessThan(Math.cos(0.12))
      }
    }
    expect(volcanoes[0]?.heat).toBe(1)
  })
})
