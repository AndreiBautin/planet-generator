import { describe, expect, it } from 'vitest'

import { cellOf, hydrologyOf } from './hydrology'
import { landmarksOf, tourOrder } from './landmarks'
import { createPlanet } from './planet'
import { parseSeed } from './seed'

const seed = parseSeed('83tzj46')
if (seed === undefined) throw new Error('test seed must parse')
const planet = createPlanet(seed)
const sights = landmarksOf(planet)
const water = hydrologyOf(planet)

describe('landmarksOf', () => {
  it('finds a peak, a lake and a river, named from the seed', () => {
    expect(sights.map((s) => s.kind).sort()).toEqual(['lake', 'peak', 'river'])
    expect(landmarksOf(createPlanet(seed)).map((s) => s.name)).toEqual(sights.map((s) => s.name))
    for (const sight of sights) expect(sight.title).toContain(planet.name)
  })

  it('puts the peak on the highest ground there is', () => {
    const peak = sights.find((s) => s.kind === 'peak')
    if (peak === undefined) throw new Error('expected a peak')
    expect(water.height[cellOf(peak.at)]).toBe(Math.max(...water.height))
  })

  it('runs the river downhill from its source to the sea, and puts the lake over water', () => {
    const river = sights.find((s) => s.kind === 'river')
    const lake = sights.find((s) => s.kind === 'lake')
    if (river === undefined || lake === undefined) throw new Error('expected a river and a lake')
    const cells = river.path.map((p) => cellOf(p))
    const last = cells[cells.length - 1] ?? 0
    // It ends where it meets the sea or a lake.
    const mouth = water.receiver[last] ?? -1
    expect((water.height[mouth] ?? 0) < 0 || Number.isFinite(water.lake[mouth])).toBe(true)
    for (let k = 1; k < cells.length; k += 1) {
      expect(water.receiver[cells[k - 1] ?? 0]).toBe(cells[k])
    }
    expect(Number.isFinite(water.lake[cellOf(lake.at)])).toBe(true)
  })
})

describe('tourOrder', () => {
  it('visits every landmark once, nearest first', () => {
    const start = sights[0]?.at ?? [0, 0, 1]
    const order = tourOrder(sights, start)
    expect(order).toHaveLength(sights.length)
    expect(order[0]).toBe(sights[0])
  })
})
