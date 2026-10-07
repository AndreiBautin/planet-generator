import { describe, expect, it } from 'vitest'

import { hydrologyOf, neighboursOf } from './hydrology'
import { createPlanet, surfaceAt } from './planet'
import { ruinIn } from './ruins'
import { parseSeed } from './seed'
import { settlementsOf } from './settlements'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

const CELLS = 6 * 128 * 128

describe('ruins', () => {
  const world = planetOf('83tzj46')
  const cells = Array.from({ length: CELLS }, (_, cell) => cell)
  const found = cells
    .map((cell) => ({ cell, ruin: ruinIn(world, cell) }))
    .filter((entry) => entry.ruin !== undefined)

  it('stand on hilltops, on dry land, away from the living towns', () => {
    // Rare, but a lived-on world has some to find.
    expect(found.length).toBeGreaterThan(5)
    expect(found.length).toBeLessThan(400)
    const { height } = hydrologyOf(world)
    const towns = settlementsOf(world).towns
    for (const { cell, ruin } of found) {
      if (ruin === undefined) continue
      for (const next of neighboursOf(cell))
        expect(height[next] ?? 0).toBeLessThan(height[cell] ?? 0)
      const surface = surfaceAt(world, ruin.at[0], ruin.at[1], ruin.at[2])
      expect(surface.height).toBeGreaterThan(0)
      expect(surface.biome).not.toBe('snow')
      for (const town of towns) {
        const dot = town.at[0] * ruin.at[0] + town.at[1] * ruin.at[1] + town.at[2] * ruin.at[2]
        expect(Math.acos(Math.min(1, dot))).toBeGreaterThan(0.03)
      }
    }
  })

  it('come in both kinds', () => {
    expect(new Set(found.map((entry) => entry.ruin?.kind)).size).toBe(2)
  })

  it('are only where people lived', () => {
    // A frozen world has no towns, so nobody left any stones.
    const frozen = planetOf('9tcwfzj')
    for (let cell = 0; cell < CELLS; cell += 7) expect(ruinIn(frozen, cell)).toBeUndefined()
  })
})
