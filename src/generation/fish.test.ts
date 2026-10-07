import { describe, expect, it } from 'vitest'

import { flockIn } from './birds'
import { FREEZES } from './features'
import { MOST_FISH, schoolIn } from './fish'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

const CELLS = 6 * 128 * 128

describe('fish', () => {
  const world = planetOf('83tzj46')
  const schools = Array.from({ length: CELLS / 41 }, (_, k) => schoolIn(world, k * 41)).filter(
    (school) => school !== undefined,
  )

  it('swim only under the sea, where the water is open', () => {
    expect(schools.length).toBeGreaterThan(50)
    for (const school of schools) {
      const surface = surfaceAt(world, school.at[0], school.at[1], school.at[2])
      expect(surface.height).toBeLessThan(0)
      expect(surface.warmth).toBeGreaterThan(FREEZES + 0.2)
      expect(school.fish).toBeLessThanOrEqual(MOST_FISH)
    }
  })

  it('keep to their water however they are asked for', () => {
    for (let cell = 0; cell < CELLS; cell += 1013)
      expect(schoolIn(world, cell)).toEqual(schoolIn(world, cell))
  })

  it('are decided apart from the birds over the same water', () => {
    // Sharing the birds' rolls, every gull flock would have a school under it.
    let both = 0
    let gulls = 0
    for (let cell = 0; cell < CELLS; cell += 41) {
      const flock = flockIn(world, cell)
      if (flock?.sea !== true) continue
      gulls += 1
      if (schoolIn(world, cell) !== undefined) both += 1
    }
    expect(gulls).toBeGreaterThan(10)
    expect(both).toBeLessThan(gulls)
  })

  it('leave a molten world empty', () => {
    const molten = planetOf('h999999')
    for (let cell = 0; cell < CELLS; cell += 211) expect(schoolIn(molten, cell)).toBeUndefined()
  })
})
