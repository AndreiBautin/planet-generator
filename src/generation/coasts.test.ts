import { describe, expect, it } from 'vitest'

import { rocksIn } from './coasts'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

const CELLS = 6 * 128 * 128

describe('rocky coasts', () => {
  const world = planetOf('83tzj46')
  const found = Array.from({ length: CELLS / 7 }, (_, k) => rocksIn(world, k * 7)).filter(
    (rocks) => rocks !== undefined,
  )

  it('stands stacks in the shallows off a high shore', () => {
    // In the water, so none is drawn on land; in the shallows, so none is a
    // pillar rising from the open ocean.
    expect(found.length).toBeGreaterThan(20)
    for (const rocks of found) {
      expect(surfaceAt(world, ...rocks.shore).height).toBeGreaterThanOrEqual(0)
      for (const stack of rocks.stacks) {
        const under = surfaceAt(world, ...stack.at).height
        expect(under).toBeLessThan(0)
        expect(under).toBeGreaterThanOrEqual(-0.03)
        expect(stack.height).toBeGreaterThan(0)
      }
    }
  })

  it('pierces some as arches, both feet in the water', () => {
    const arches = found.filter((rocks) => rocks.arch !== undefined)
    expect(arches.length).toBeGreaterThan(2)
    for (const { arch } of arches) {
      if (arch === undefined) continue
      expect(surfaceAt(world, ...arch.from).height).toBeLessThan(0)
      expect(surfaceAt(world, ...arch.to).height).toBeLessThan(0)
    }
  })

  it('keeps to its headland however it is asked for', () => {
    for (let cell = 0; cell < CELLS; cell += 1013)
      expect(rocksIn(world, cell)).toEqual(rocksIn(world, cell))
  })

  it('leaves a molten world without', () => {
    const molten = planetOf('h999999')
    for (let cell = 0; cell < CELLS; cell += 211) expect(rocksIn(molten, cell)).toBeUndefined()
  })
})
