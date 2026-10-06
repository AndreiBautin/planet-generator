import { describe, expect, it } from 'vitest'

import { createPlanet, surfaceAt, type Surface } from './planet'
import { duneWeight, fineReliefAt, fineReliefWeight, reliefWeightAt } from './relief'
import { parseSeed, type Seed } from './seed'

const parsed = parseSeed('k3m9xqa')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed

describe('fine relief', () => {
  it('leaves the pinned surface untouched: adding it moves no shared planet', () => {
    // The same value planet.test.ts pins; fine relief has its own fork and
    // never feeds back into surfaceAt.
    const planet = createPlanet(seed)
    expect(surfaceAt(planet, 0.2, 0.5, -0.8).height.toFixed(8)).toMatchInlineSnapshot(
      `"-0.38785192"`,
    )
  })

  it('stays within a small band', () => {
    const planet = createPlanet(seed)
    for (let at = 0; at < 300; at += 1) {
      const value = fineReliefAt(planet, Math.sin(at), Math.cos(at * 1.3), Math.sin(at * 0.7))
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(2.5)
    }
  })

  it('carries none at the shore, so the coastline does not move', () => {
    expect(fineReliefWeight(-0.1)).toBe(0)
    expect(fineReliefWeight(0)).toBe(0)
    expect(fineReliefWeight(0.02)).toBe(0)
    expect(fineReliefWeight(0.6)).toBeGreaterThan(fineReliefWeight(0.1))
  })

  it('draws dunes over dry lowland and none on a snowfield or at sea', () => {
    const planet = createPlanet(seed)
    const spot = (over: Partial<Surface>): Surface => ({
      height: 0.1,
      biome: 'land',
      colour: [0, 0, 0],
      moisture: 0.2,
      warmth: 0.85,
      ...over,
    })
    expect(duneWeight(planet, spot({}))).toBeGreaterThan(0.9)
    expect(duneWeight({ ...planet, kind: 'arid' }, spot({ warmth: -0.2, moisture: 0.4 }))).toBe(1)
    expect(duneWeight(planet, spot({ warmth: -0.2, moisture: 0.4 }))).toBe(0)
    expect(duneWeight(planet, spot({ biome: 'snow' }))).toBe(0)
    expect(duneWeight(planet, spot({ height: -0.1 }))).toBe(0)
    expect(duneWeight(planet, spot({ height: 0.6 }))).toBe(0)
    // Dune country carries relief where crags would carry none.
    expect(reliefWeightAt(planet, spot({ height: 0.05 }))).toBeGreaterThan(
      fineReliefWeight(0.05) * 3,
    )
    expect(reliefWeightAt(planet, spot({ height: 0.005 }))).toBe(0)
  })

  it('is rougher on a rougher planet', () => {
    const smooth = createPlanet(seed, { water: 0.55, temperature: 0, roughness: 0, season: 0.25 })
    const rough = createPlanet(seed, { water: 0.55, temperature: 0, roughness: 1, season: 0.25 })
    expect(fineReliefAt(rough, 0.3, 0.4, 0.86)).toBeGreaterThan(
      fineReliefAt(smooth, 0.3, 0.4, 0.86),
    )
  })
})
