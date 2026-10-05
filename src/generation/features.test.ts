import { describe, expect, it } from 'vitest'

import { featuresAt, FEATURES, floorAt, patternAt, type Growth } from './features'
import { createPlanet, type Surface } from './planet'
import { parseSeed, type Seed } from './seed'

const parsed = parseSeed('2257afq')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed
const planet = createPlanet(seed)
const molten = { ...planet, molten: true }
const arid = { ...planet, kind: 'arid' as const }

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

  it('closes the canopy: a wood at its fullest is nearly a tree per spot', () => {
    const growth = featuresAt(planet, ground({ moisture: 0.9, warmth: 0.3 }), 0)
    expect(growth.broadleaf + growth.conifer).toBeGreaterThan(0.85)
  })

  it('grows no forest on an arid world, however damp a patch of it is', () => {
    const growth = featuresAt(arid, ground({ moisture: 0.85, warmth: 0.3 }), 0)
    expect(growth.broadleaf + growth.conifer).toBe(0)
    expect(growth.cactus).toBeGreaterThan(0)
  })

  it('grows a boreal belt of pines on cold damp ground', () => {
    const growth = featuresAt(planet, ground({ moisture: 0.6, warmth: -0.4 }), 0)
    expect(growth.conifer).toBeGreaterThan(0.5)
    expect(growth.broadleaf).toBe(0)
  })

  it('roots nothing on a cliff, and strews it with rock', () => {
    const flat = featuresAt(planet, ground({ moisture: 0.85 }), 0)
    const cliff = featuresAt(planet, ground({ moisture: 0.85 }), 0.3)
    expect(flat.broadleaf + flat.conifer).toBeGreaterThan(0.5)
    expect(cliff.broadleaf + cliff.conifer).toBeLessThan(0.01)
    expect(floorAt(planet, ground({ moisture: 0.85 }), 0.3).rock).toBeGreaterThan(
      floorAt(planet, ground({ moisture: 0.85 }), 0).rock,
    )
  })

  it('stands ice spires and boulders on snow, with only a few pines', () => {
    const growth = featuresAt(planet, ground({ biome: 'snow', warmth: -0.5 }), 0.25)
    expect(growth.spire).toBeGreaterThan(0)
    expect(featuresAt(planet, ground({ biome: 'snow', warmth: -0.5 }), 0).spire).toBe(0)
    expect(growth.boulder).toBeGreaterThan(0)
    expect(growth.broadleaf).toBe(0)
  })

  it('packs a frozen sea with ice, plate to plate, and scatters floes past its edge', () => {
    const frozen = featuresAt(planet, ground({ height: -0.1, biome: 'sea-ice', warmth: -0.6 }), 0)
    const edge = featuresAt(planet, ground({ height: -0.1, biome: 'shallow', warmth: -0.35 }), 0)
    const warm = featuresAt(planet, ground({ height: -0.1, biome: 'shallow', warmth: 0.4 }), 0)
    expect(frozen.floe + frozen.boulder).toBeGreaterThan(0.85)
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

  it('grows nothing living on a molten world: columns, cones and rubble instead', () => {
    const growth = featuresAt(molten, ground({ moisture: 0.9, height: 0.05 }), 0)
    const floor = floorAt(molten, ground({ moisture: 0.9, height: 0.05 }), 0)
    expect(growth.broadleaf + growth.conifer + growth.cactus).toBe(0)
    expect(floor.shrub + floor.grass).toBe(0)
    expect(growth.spire).toBeGreaterThan(0.1)
    expect(growth.cone).toBeGreaterThan(0)
    expect(floor.rock).toBeGreaterThan(0.1)
    expect(total(featuresAt(molten, ground({ height: -0.1, biome: 'shallow' }), 0))).toBe(0)
  })

  it('never asks for more than one thing per spot in either layer', () => {
    for (const world of [planet, arid, molten]) {
      for (const moisture of [0, 0.3, 0.6, 1]) {
        for (const warmth of [-0.6, -0.2, 0.3, 0.9]) {
          for (const steep of [0, 0.1, 0.3]) {
            for (const height of [-0.2, -0.01, 0.1, 0.6]) {
              const spot = ground({ moisture, warmth, height })
              expect(total(featuresAt(world, spot, steep))).toBeLessThanOrEqual(1)
              expect(total(floorAt(world, spot, steep))).toBeLessThanOrEqual(1)
            }
          }
        }
      }
    }
  })
})

describe('floorAt', () => {
  it('puts undergrowth under a wood and turf on open damp ground', () => {
    const wood = floorAt(planet, ground({ moisture: 0.9, warmth: 0.3 }), 0)
    const meadow = floorAt(planet, ground({ moisture: 0.35, warmth: 0.3 }), 0)
    expect(wood.shrub).toBeGreaterThan(0.2)
    expect(meadow.grass).toBeGreaterThan(wood.grass)
    expect(meadow.grass).toBeGreaterThan(0.2)
  })

  it('covers a desert floor with rock and dry scrub, no turf to speak of', () => {
    const floor = floorAt(arid, ground({ moisture: 0.2, warmth: 0.6 }), 0)
    expect(floor.rock).toBeGreaterThan(0.1)
    expect(floor.shrub).toBeGreaterThan(0.1)
    expect(floor.grass).toBeLessThan(0.1)
  })

  it('covers nothing at sea or on the shoreline', () => {
    expect(total(floorAt(planet, ground({ height: -0.1, biome: 'shallow' }), 0))).toBe(0)
    expect(total(floorAt(planet, ground({ height: 0.005 }), 0))).toBe(0)
  })
})

describe('patternAt', () => {
  it('reads a forest as canopy, a beach as sand, snow as snow and a cliff as stone', () => {
    expect(patternAt(planet, ground({ moisture: 0.9, warmth: 0.5 }), 0).canopy).toBeGreaterThan(0.5)
    expect(patternAt(planet, ground({ biome: 'shore', height: 0.015 }), 0).sand).toBe(1)
    expect(patternAt(planet, ground({ biome: 'snow' }), 0).snow).toBe(1)
    expect(patternAt(planet, ground({}), 0.3).stone).toBe(1)
  })

  it('reads all of an arid world as sand, and a molten lowland as lava', () => {
    expect(patternAt(arid, ground({ moisture: 0.4, warmth: 0.1 }), 0).sand).toBeGreaterThan(0.9)
    expect(patternAt(molten, ground({ height: 0.03 }), 0).sand).toBeGreaterThan(0.9)
    expect(patternAt(molten, ground({ height: 0.5 }), 0).sand).toBe(0)
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
