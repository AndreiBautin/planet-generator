import { describe, expect, it } from 'vitest'

import { caravanIn, desertAt, oasisIn } from './oases'
import { createPlanet } from './planet'
import { parseSeed } from './seed'

const CELLS = 6 * 128 * 128

/** An arid world: the deserts live there. */
function aridWorld(): ReturnType<typeof createPlanet> {
  const seed = parseSeed('aaangxg')
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('deserts', () => {
  const world = aridWorld()
  const oases = Array.from({ length: CELLS / 5 }, (_, k) => oasisIn(world, k * 5)).filter(
    (oasis) => oasis !== undefined,
  )
  const caravans = Array.from({ length: CELLS / 5 }, (_, k) => caravanIn(world, k * 5)).filter(
    (caravan) => caravan !== undefined,
  )

  it('puts oases and caravans in the desert, and some of each on a dry world', () => {
    expect(world.kind).toBe('arid')
    expect(oases.length).toBeGreaterThan(5)
    expect(caravans.length).toBeGreaterThan(5)
    for (const oasis of oases) expect(desertAt(world, oasis.at)).toBeGreaterThanOrEqual(0.6)
    for (const caravan of caravans) {
      expect(desertAt(world, caravan.from)).toBeGreaterThanOrEqual(0.5)
      expect(desertAt(world, caravan.to)).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('keeps each where it is however it is asked for', () => {
    for (let cell = 0; cell < CELLS; cell += 1013) {
      expect(oasisIn(world, cell)).toEqual(oasisIn(world, cell))
      expect(caravanIn(world, cell)).toEqual(caravanIn(world, cell))
    }
  })
})
