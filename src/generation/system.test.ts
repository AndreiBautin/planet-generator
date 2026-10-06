import { describe, expect, it } from 'vitest'

import { parseSeed, type Seed } from './seed'
import { systemOf } from './system'

const seedOf = (raw: string): Seed => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return seed
}

describe('a star system', () => {
  const home = seedOf('83tzj46')
  const system = systemOf(home)

  it('holds its home among three to six worlds, each its own planet', () => {
    expect(system.worlds.length).toBeGreaterThanOrEqual(3)
    expect(system.worlds.length).toBeLessThanOrEqual(6)
    expect(system.worlds.filter((w) => w.seed === home)).toHaveLength(1)
    expect(new Set(system.worlds.map((w) => w.seed)).size).toBe(system.worlds.length)
    for (const world of system.worlds) expect(parseSeed(world.seed)).toBe(world.seed)
  })

  it('orders its worlds outwards', () => {
    const orbits = system.worlds.map((w) => w.orbit)
    expect(orbits).toEqual([...orbits].sort((a, b) => a - b))
    expect(orbits[0]).toBe(1)
  })

  it('is the same system from the same home, every time', () => {
    expect(systemOf(home)).toEqual(system)
    expect(systemOf(seedOf('k3m9xqa')).worlds.map((w) => w.seed)).not.toEqual(
      system.worlds.map((w) => w.seed),
    )
  })
})
