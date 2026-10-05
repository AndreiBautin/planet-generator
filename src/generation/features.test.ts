import { describe, expect, it } from 'vitest'

import { featuresAt, FEATURES, patternAt, type Growth } from './features'
import { createPlanet, type Surface } from './planet'
import { parseSeed, type Seed } from './seed'

const parsed = parseSeed('2257afq')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed
const planet = createPlanet(seed)
const molten = { ...planet, molten: true }

const ground = (overrides: Partial<Surface>): Surface => ({
  height: 0.15,
  biome: 'land',
  colour: [0, 0, 0],
  moisture: 0.5,
  warmth: 0.4,
  ...overrides,
})
const total = (growth: Growth): number => FEATURES.reduce((sum, f) => sum + growth[f], 0)

describe('featuresAt', () => {
  it('grows a broadleaf forest on wet, warm lowland', () => {
    const growth = featuresAt(planet, ground({ moisture: 0.85, warmth: 0.5 }), 0)
    expect(growth.broadleaf).toBeGreaterThan(growth.conifer)
    expect(growth.broadleaf).toBeGreaterThan(0.4)
  })

  it('turns to pines as the ground cools and climbs', () => {
    const growth = featuresAt(
      planet,
      ground({ moisture: 0.85, warmth: -0.15, height: 0.45, biome: 'highland' }),
      0,
    )
    expect(growth.conifer).toBeGreaterThan(growth.broadleaf)
  })

  it('grows no forest where it is very hot, however wet', () => {
    const growth = featuresAt(planet, ground({ moisture: 0.9, warmth: 0.95 }), 0)
    expect(growth.broadleaf + growth.conifer).toBeLessThan(0.05)
  })

  it('grows cacti and scrub, not forest, where it is hot and dry', () => {
    const growth = featuresAt(planet, ground({ moisture: 0.2, warmth: 0.9 }), 0)
    expect(growth.cactus).toBeGreaterThan(0)
    expect(growth.broadleaf + growth.conifer).toBeLessThan(0.05)
  })

  it('roots nothing on a cliff, and strews it with rock', () => {
    const flat = featuresAt(planet, ground({ moisture: 0.85 }), 0)
    const cliff = featuresAt(planet, ground({ moisture: 0.85 }), 0.3)
    expect(cliff.broadleaf + cliff.conifer).toBeLessThan(0.01)
    expect(cliff.rock).toBeGreaterThan(flat.rock)
  })

  it('stands ice spires and boulders on snow, with only a few pines', () => {
    const growth = featuresAt(planet, ground({ biome: 'snow', warmth: -0.5 }), 0.15)
    expect(growth.spire).toBeGreaterThan(0)
    expect(growth.boulder).toBeGreaterThan(0)
    expect(growth.broadleaf).toBe(0)
  })

  it('floats floes on a frozen sea, and a few past its edge', () => {
    const frozen = featuresAt(planet, ground({ height: -0.1, biome: 'sea-ice', warmth: -0.6 }), 0)
    const edge = featuresAt(planet, ground({ height: -0.1, biome: 'shallow', warmth: -0.35 }), 0)
    const warm = featuresAt(planet, ground({ height: -0.1, biome: 'shallow', warmth: 0.4 }), 0)
    expect(frozen.floe).toBeGreaterThan(edge.floe)
    expect(edge.floe).toBeGreaterThan(0)
    expect(warm.floe).toBe(0)
  })

  it('stands a few stacks off a coast, and nothing out in the deep', () => {
    expect(
      featuresAt(planet, ground({ height: -0.01, biome: 'shallow' }), 0).boulder,
    ).toBeGreaterThan(0)
    expect(total(featuresAt(planet, ground({ height: -0.3, biome: 'deep' }), 0))).toBe(0)
  })

  it('grows nothing living on a molten world, and stands basalt on it', () => {
    const growth = featuresAt(molten, ground({ moisture: 0.9 }), 0)
    expect(growth.broadleaf + growth.conifer + growth.shrub + growth.cactus).toBe(0)
    expect(growth.spire).toBeGreaterThan(0)
    expect(total(featuresAt(molten, ground({ height: -0.1, biome: 'shallow' }), 0))).toBe(0)
  })

  it('never asks for more than one feature per spot', () => {
    for (const moisture of [0, 0.3, 0.6, 1]) {
      for (const warmth of [-0.6, -0.2, 0.3, 0.9]) {
        for (const steep of [0, 0.1, 0.3]) {
          for (const height of [-0.2, -0.01, 0.1, 0.6]) {
            expect(
              total(featuresAt(planet, ground({ moisture, warmth, height }), steep)),
            ).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})

describe('patternAt', () => {
  it('reads a forest as canopy, a beach as sand, snow as snow and a cliff as stone', () => {
    expect(patternAt(planet, ground({ moisture: 0.9, warmth: 0.5 }), 0).canopy).toBeGreaterThan(0.5)
    expect(patternAt(planet, ground({ biome: 'shore', height: 0.015 }), 0).sand).toBe(1)
    expect(patternAt(planet, ground({ biome: 'snow' }), 0).snow).toBe(1)
    expect(patternAt(planet, ground({}), 0.3).stone).toBe(1)
  })

  it('leaves the sea floor plain', () => {
    expect(patternAt(planet, ground({ height: -0.1, biome: 'shallow' }), 0)).toEqual({
      canopy: 0,
      sand: 0,
      snow: 0,
      stone: 0,
    })
  })
})
