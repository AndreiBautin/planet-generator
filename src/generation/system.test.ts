import { describe, expect, it } from 'vitest'

import { parseSeed, type Seed } from './seed'
import { skyWorlds, systemOf, type StarSystem } from './system'

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

describe('sister worlds in the sky', () => {
  const home = seedOf('83tzj46')
  const system = systemOf(home)
  const sun: [number, number, number] = [0.9, 0.1, 0.42]

  it('shows every other world, and not the one it is seen from', () => {
    const sky = skyWorlds(system, home, sun)
    expect(sky).toHaveLength(system.worlds.length - 1)
    for (const world of sky) {
      expect(Math.hypot(...world.direction)).toBeCloseTo(1, 6)
      expect(world.brightness).toBeGreaterThan(0)
    }
    expect(skyWorlds(system, seedOf('k3m9xqa'), sun)).toEqual([])
  })

  it('puts a world beyond the star behind the sun, full, and one between dark', () => {
    // A made-up system: the home at 2, one world straight beyond the star, one straight between.
    const at = (seed: string, orbit: number, angle: number) => ({
      seed: seedOf(seed),
      name: seed,
      kind: 'temperate' as const,
      orbit,
      angle,
      size: 1,
      sea: [0, 0, 1] as const,
      land: [0, 1, 0] as const,
    })
    const made: StarSystem = {
      home,
      star: { name: 'star', colour: [1, 1, 1] },
      worlds: [at('k3m9xqa', 1, 0), at('83tzj46', 2, 0), at('h999999', 1, Math.PI)],
    }
    const [between, beyond] = skyWorlds(made, home, sun)
    const s = Math.hypot(...sun)
    const towards = (d: readonly [number, number, number]): number =>
      (d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2]) / s
    expect(towards(beyond?.direction ?? [0, 0, 0])).toBeCloseTo(1, 6)
    expect(towards(between?.direction ?? [0, 0, 0])).toBeCloseTo(1, 6)
    // Same size and orbit, but the one between is three times nearer: full,
    // it would be nine times as bright. A new crescent, it is a fraction of that.
    expect((between?.brightness ?? 1) / (beyond?.brightness ?? 1)).toBeLessThan(9 * 0.2)
  })
})
