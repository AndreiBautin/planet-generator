import { describe, expect, it } from 'vitest'

import { createNoise3 } from './noise'
import { PLANET_KINDS, type PlanetKind } from './kinds'
import { createPlanet, surfaceAt } from './planet'
import { createRng } from './rng'
import { newSeed, parseSeed, type Seed } from './seed'

const seed = (text: string): Seed => {
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error(`bad test seed ${text}`)
  return parsed
}

/** Evenly spread points on the unit sphere (a Fibonacci lattice). */
function spherePoints(count: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, at) => {
    const y = 1 - (2 * (at + 0.5)) / count
    const r = Math.sqrt(1 - y * y)
    return [Math.cos(golden * at) * r, y, Math.sin(golden * at) * r]
  })
}

/** The first seed in a run that makes the given kind, for tests about one kind. */
function seedOfKind(kind: PlanetKind): Seed {
  for (let at = 0; at < 500; at += 1) {
    const candidate = newSeed((bytes) => {
      bytes.set([at % 31, (at >> 5) % 31, 7, 11, 13, 17, 19])
    })
    if (createPlanet(candidate).kind === kind) return candidate
  }
  throw new Error(`no ${kind} seed in 500`)
}

const share = (
  planet: ReturnType<typeof createPlanet>,
  test: (biome: string, height: number) => boolean,
) => {
  const points = spherePoints(2000)
  return (
    points.filter(([x, y, z]) => {
      const surface = surfaceAt(planet, x, y, z)
      return test(surface.biome, surface.height)
    }).length / points.length
  )
}

const landShare = (water: number): number => {
  const planet = createPlanet(seedOfKind('temperate'), { water, temperature: 0, roughness: 0.5 })
  const points = spherePoints(2000)
  return points.filter(([x, y, z]) => surfaceAt(planet, x, y, z).height > 0).length / points.length
}

describe('the noise', () => {
  /* Pinned, for the reason the generator is: a change here moves every planet. */
  it('gives the same value at a point for a seed, forever', () => {
    const noise = createNoise3(createRng('k3m9xqa').fork('continents'))
    expect(noise(0.3, -0.7, 1.9).toFixed(8)).toMatchInlineSnapshot(`"0.58507718"`)
  })

  it('stays in roughly [-1, 1]', () => {
    const noise = createNoise3(createRng('bounds22'))
    for (const [x, y, z] of spherePoints(3000)) {
      const value = noise(x * 7, y * 7, z * 7)
      expect(Math.abs(value)).toBeLessThanOrEqual(1.01)
    }
  })
})

describe('a planet', () => {
  it('has the same surface at a point for a seed, forever', () => {
    const planet = createPlanet(seed('k3m9xqa'))
    const { height } = surfaceAt(planet, 0.2, 0.5, -0.8)
    expect(height.toFixed(8)).toMatchInlineSnapshot(`"-0.38785192"`)
  })

  it('reads a point off the sphere as the point on it, whatever its length', () => {
    const planet = createPlanet(seed('k3m9xqa'))
    const short = surfaceAt(planet, 0.2, 0.5, -0.8)
    const long = surfaceAt(planet, 2, 5, -8)
    // The two directions normalise to the same point within a rounding, so
    // the readings agree to well past anything that could be seen.
    expect(long.biome).toBe(short.biome)
    for (const field of ['height', 'moisture', 'warmth'] as const) {
      expect(long[field]).toBeCloseTo(short[field], 12)
    }
  })

  /* The water dial must do what it says, or the control is decoration. */
  it('drowns more of the land as the water rises', () => {
    const dry = landShare(0.1)
    const wet = landShare(0.9)
    expect(dry).toBeGreaterThan(0.7)
    expect(wet).toBeLessThan(0.3)
    expect(landShare(0.5)).toBeGreaterThan(wet)
    expect(landShare(0.5)).toBeLessThan(dry)
  })

  it('gives different seeds different coastlines', () => {
    const a = createPlanet(seed('k3m9xqa'))
    const b = createPlanet(seed('k3m9xqb'))
    const differs = spherePoints(200).some(
      ([x, y, z]) => surfaceAt(a, x, y, z).height > 0 !== surfaceAt(b, x, y, z).height > 0,
    )
    expect(differs).toBe(true)
  })

  it('clamps a dial from a link rather than trusting it', () => {
    const planet = createPlanet(seed('k3m9xqa'), {
      water: 7,
      temperature: Number.NaN,
      roughness: -3,
    })
    expect(planet.dials).toEqual({ water: 1, temperature: -1, roughness: 0 })
  })
})

describe('kinds, climates and names', () => {
  it('makes every kind of world somewhere among a few hundred seeds', () => {
    for (const kind of PLANET_KINDS) expect(() => seedOfKind(kind)).not.toThrow()
  })

  it('names a planet the same way every time, in letters a person can say', () => {
    const planet = createPlanet(seed('k3m9xqa'))
    expect(createPlanet(seed('k3m9xqa')).name).toBe(planet.name)
    expect(planet.name).toMatch(/^[A-Z][a-z]{2,14}(-[0-9]{1,2})?$/)
  })

  /* The temperature dial must do what it says, the way the water dial must. */
  it('melts the ice as the temperature rises', () => {
    const base = seedOfKind('temperate')
    const ice = (temperature: number) =>
      share(
        createPlanet(base, { water: 0.55, temperature, roughness: 0.5 }),
        (biome) => biome === 'snow' || biome === 'sea-ice',
      )
    expect(ice(-1)).toBeGreaterThan(ice(0))
    expect(ice(0)).toBeGreaterThan(ice(1))
    expect(ice(-1)).toBeGreaterThan(0.4)
  })

  it('gives a temperate world polar ice and a warm middle', () => {
    const planet = createPlanet(seedOfKind('temperate'))
    const polar = surfaceAt(planet, 0, 1, 0).biome
    expect(['snow', 'sea-ice']).toContain(polar)
  })

  it('never freezes a molten sea', () => {
    const planet = createPlanet(seedOfKind('volcanic'), {
      water: 0.55,
      temperature: -1,
      roughness: 0.5,
    })
    expect(share(planet, (biome) => biome === 'sea-ice')).toBe(0)
  })
})
