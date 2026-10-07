import { describe, expect, it } from 'vitest'

import { airshipIn, balloonsIn, MOST_BALLOONS } from './aircraft'
import { createPlanet } from './planet'
import { surfaceAt } from './planet'
import { parseSeed } from './seed'

const CELLS = 6 * 128 * 128

function world(name: string): ReturnType<typeof createPlanet> {
  const seed = parseSeed(name)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('aircraft', () => {
  it('flies balloons over land and airships anywhere on a living world', () => {
    const temperate = world('k3m9xqa')
    const meets = Array.from({ length: CELLS / 3 }, (_, k) => balloonsIn(temperate, k * 3)).filter(
      (meet) => meet !== undefined,
    )
    const ships = Array.from({ length: CELLS / 3 }, (_, k) => airshipIn(temperate, k * 3)).filter(
      (ship) => ship !== undefined,
    )
    expect(meets.length).toBeGreaterThan(20)
    expect(ships.length).toBeGreaterThan(20)
    for (const meet of meets) {
      expect(surfaceAt(temperate, ...meet.at).height).toBeGreaterThan(0.01)
      expect(meet.balloons).toBeGreaterThanOrEqual(1)
      expect(meet.balloons).toBeLessThanOrEqual(MOST_BALLOONS)
    }
  })

  it('keeps a molten world’s sky empty', () => {
    const molten = world('h999999')
    for (let cell = 0; cell < CELLS; cell += 97) {
      expect(balloonsIn(molten, cell)).toBeUndefined()
      expect(airshipIn(molten, cell)).toBeUndefined()
    }
  })

  it('keeps each where it is however it is asked for', () => {
    const temperate = world('k3m9xqa')
    for (let cell = 0; cell < CELLS; cell += 1013) {
      expect(balloonsIn(temperate, cell)).toEqual(balloonsIn(temperate, cell))
      expect(airshipIn(temperate, cell)).toEqual(airshipIn(temperate, cell))
    }
  })
})
