import { describe, expect, it } from 'vitest'

import { floorHeightAt, hydrologyOf, LAKE_DEPTH, neighboursOf, RIVER_FLOW } from './hydrology'
import { createPlanet } from './planet'
import { parseSeed } from './seed'

const seed = parseSeed('83tzj46')
if (seed === undefined) throw new Error('test seed must parse')
const planet = createPlanet(seed)
const water = hydrologyOf(planet)

describe('hydrology', () => {
  it('reads the floor of the ground round a point smoothly as the point moves', () => {
    // The dawn mist fills up from this floor: a jump in it where the cells
    // round a point change would draw the mist's edge as a staircase.
    const near = new Map<number, readonly number[]>()
    const step = 0.0004
    let worst = 0
    for (let k = 0; k < 400; k += 1) {
      const t = k * step
      const a = floorHeightAt(water, [Math.sin(t), 0.3, Math.cos(t)], near, 1)
      const b = floorHeightAt(water, [Math.sin(t + step), 0.3, Math.cos(t + step)], near, 1)
      worst = Math.max(worst, Math.abs(a - b))
    }
    expect(worst).toBeLessThan(0.004)
  })

  it('fills the whole hollow of a lake: no ground beside one lies under its level', () => {
    // Stopped at its deepest cells, a lake's water ended where the grid
    // did, and its shore was a staircase of cell edges.
    const { height, lake } = water
    let checked = 0
    for (let cell = 0; cell < height.length; cell += 1) {
      const level = lake[cell] ?? Number.NEGATIVE_INFINITY
      if (!Number.isFinite(level)) continue
      for (const next of neighboursOf(cell)) {
        if (Number.isFinite(lake[next] ?? Number.NEGATIVE_INFINITY) || (height[next] ?? 0) < 0)
          continue
        checked += 1
        expect(height[next] ?? 0).toBeGreaterThanOrEqual(level - 1e-3)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('drains every land cell to the sea, never climbing on the way', () => {
    const { height, lake, receiver } = water
    const level = (cell: number): number => Math.max(height[cell] ?? 0, lake[cell] ?? 0)
    for (let cell = 0; cell < height.length; cell += 97) {
      if ((height[cell] ?? 0) < 0) continue
      let at = cell
      for (let steps = 0; steps < 100_000; steps += 1) {
        const down = receiver[at] ?? -1
        if (down < 0) break
        // A hollow shallower than a lake is worth is filled to flow on but not drawn.
        expect(level(down)).toBeLessThanOrEqual(level(at) + LAKE_DEPTH + 1e-4)
        at = down
      }
      expect(receiver[at]).toBe(-1)
    }
  })

  it('holds lakes above their floors, and has rivers to draw', () => {
    const { height, lake, flow } = water
    let rivers = 0
    let lakes = 0
    for (let cell = 0; cell < height.length; cell += 1) {
      const surface = lake[cell] ?? Number.NEGATIVE_INFINITY
      if (Number.isFinite(surface)) {
        lakes += 1
        expect(surface).toBeGreaterThan(height[cell] ?? 0)
      }
      if ((height[cell] ?? 0) > 0 && (flow[cell] ?? 0) > RIVER_FLOW) rivers += 1
    }
    expect(rivers).toBeGreaterThan(100)
    expect(lakes).toBeGreaterThan(0)
  })

  it('is the same map every time, and quick enough to make per planet', () => {
    const again = createPlanet(seed)
    const start = performance.now()
    const fresh = hydrologyOf(again)
    expect(performance.now() - start).toBeLessThan(3000)
    expect(Array.from(fresh.flow.slice(0, 2000))).toEqual(Array.from(water.flow.slice(0, 2000)))
  })
})
