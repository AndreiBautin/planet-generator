import { describe, expect, it } from 'vitest'

import { directionOn } from './cube'
import { createPlanet, surfaceAt, type Planet } from './planet'
import { parseSeed, type Seed } from './seed'
import {
  AREA,
  blockAt,
  columnAt,
  columnOf,
  directionOf,
  HEIGHT,
  landingAt,
  SEA_LEVEL,
  type Block,
  type Landing,
} from './voxel'

const seedOf = (text: string): Seed => {
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error('test seed must parse')
  return parsed
}
const temperate = createPlanet(seedOf('2257afq'))
const volcanic = createPlanet(seedOf('s257afq'))

/** A direction on a planet where the surface answers `wanted`, found by search. */
function spotWhere(
  planet: Planet,
  wanted: (s: ReturnType<typeof surfaceAt>) => boolean,
): [number, number, number] {
  for (let at = 0; at < 4000; at += 1) {
    const d = directionOn(4, (at % 63) / 31 - 1, Math.floor(at / 63) / 31 - 1)
    if (wanted(surfaceAt(planet, d[0], d[1], d[2]))) return [d[0], d[1], d[2]]
  }
  throw new Error('no such spot')
}

const column = (landing: Landing, x: number, z: number): Block[] => {
  const col = columnAt(landing, x, z)
  const out: Block[] = []
  for (let y = 0; y < HEIGHT; y += 1) out.push(blockAt(landing, x, z, col, y))
  return out
}

describe('a landing', () => {
  it('is the same blocks every time, for the same seed and spot', () => {
    const spot = spotWhere(temperate, (s) => s.biome === 'land' && s.height > 0.05)
    const a = landingAt(temperate, spot)
    const b = landingAt(temperate, spot)
    expect(column(a, 100, 100)).toEqual(column(b, 100, 100))
    expect(a.stamps.size).toBe(b.stamps.size)
  })

  it('cuts land as grass over earth over stone, with air above', () => {
    const spot = spotWhere(temperate, (s) => s.biome === 'land' && s.height > 0.08)
    const landing = landingAt(temperate, spot)
    const col = columnAt(landing, AREA / 2, AREA / 2)
    const blocks = column(landing, AREA / 2, AREA / 2)
    expect(col.ground).toBeGreaterThan(SEA_LEVEL)
    expect(blocks[col.ground]).toBe('grass')
    expect(blocks[col.ground - 1]).toBe('earth')
    expect(blocks[col.ground - 5]).toBe('stone')
    expect(blocks[0]).toBe('stone')
    // Nothing but air, or a tree, above the ground.
    for (let y = col.ground + 1; y < HEIGHT; y += 1) {
      expect(['air', 'wood', 'leaves', 'needles', 'stone']).toContain(blocks[y])
    }
  })

  it('fills below sea level with water over a sandy floor', () => {
    const spot = spotWhere(temperate, (s) => s.height < -0.05)
    const landing = landingAt(temperate, spot)
    const col = columnAt(landing, AREA / 2, AREA / 2)
    const blocks = column(landing, AREA / 2, AREA / 2)
    expect(col.ground).toBeLessThan(SEA_LEVEL)
    expect(blocks[col.ground]).toBe('sand')
    expect(blocks[SEA_LEVEL]).toBe('water')
    expect(blocks[SEA_LEVEL + 1]).toBe('air')
  })

  it('cuts a molten world as basalt, with a sea of lava', () => {
    const landing = landingAt(
      volcanic,
      spotWhere(volcanic, (s) => s.height < -0.05),
    )
    const blocks = column(landing, AREA / 2, AREA / 2)
    expect(blocks[SEA_LEVEL]).toBe('lava')
    const land = landingAt(
      volcanic,
      spotWhere(volcanic, (s) => s.height > 0.08),
    )
    const col = columnAt(land, AREA / 2, AREA / 2)
    expect(column(land, AREA / 2, AREA / 2)[col.ground]).toBe('basalt')
  })

  it('puts snow on the snow biome', () => {
    const spot = spotWhere(temperate, (s) => s.biome === 'snow')
    const landing = landingAt(temperate, spot)
    const col = columnAt(landing, AREA / 2, AREA / 2)
    expect(column(landing, AREA / 2, AREA / 2)[col.ground]).toBe('snow')
  })

  it('stamps block trees where the flyover had a wood', () => {
    const spot = spotWhere(
      temperate,
      (s) =>
        s.moisture > 0.7 && s.warmth > 0.1 && s.warmth < 0.5 && s.height > 0.06 && s.height < 0.3,
    )
    const landing = landingAt(temperate, spot)
    const kinds = new Set(landing.stamps.values())
    expect(kinds.has('wood')).toBe(true)
    expect(kinds.has('leaves') || kinds.has('needles')).toBe(true)
    // A trunk stands on the ground, not in it or over a gap.
    let trunks = 0
    for (const [key, block] of landing.stamps) {
      if (block !== 'wood') continue
      const y = key % 256
      const z = (Math.floor(key / 256) % 2048) - 1024
      const x = Math.floor(key / 256 / 2048) - 1024
      if (x < 0 || z < 0 || x >= AREA || z >= AREA) continue
      const col = columnAt(landing, x, z)
      if (y === col.ground + 1) trunks += 1
    }
    expect(trunks).toBeGreaterThan(0)
  })

  it('maps a column to a direction and back', () => {
    const landing = landingAt(temperate, [0.3, 0.5, 0.81])
    const [x, z] = columnOf(landing, directionOf(landing, 37, 201))
    expect(x).toBeCloseTo(37, 6)
    expect(z).toBeCloseTo(201, 6)
  })
})
