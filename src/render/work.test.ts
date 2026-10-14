import { describe, expect, it } from 'vitest'

import { adoptHydrology, hydrologyOf } from '@/generation/hydrology'
import { createPlanet, DEFAULT_DIALS } from '@/generation/planet'
import { parseSeed } from '@/generation/seed'

import { answer, transferables } from './work'

describe('the hydrology job', () => {
  const seed = parseSeed('83tzj46')
  if (seed === undefined) throw new Error('test seed did not parse')

  it("hands the page the drainage map it would have made itself, and keeps the worker's own", () => {
    const result = answer({ id: 1, kind: 'hydrology', seed, dials: DEFAULT_DIALS })
    if (result.kind !== 'hydrology') throw new Error('wrong kind')
    // The page's planet adopts it, and asks no more.
    const page = createPlanet(seed, DEFAULT_DIALS)
    expect(adoptHydrology(page, result.hydrology)).toBe(true)
    expect(hydrologyOf(page)).toBe(result.hydrology)
    expect(adoptHydrology(page, result.hydrology)).toBe(false)
    // The same map the page would have made: the seed promise.
    const own = hydrologyOf(createPlanet(seed, DEFAULT_DIALS))
    expect(result.hydrology.height).toEqual(own.height)
    expect(result.hydrology.receiver).toEqual(own.receiver)
    expect(result.hydrology.lake).toEqual(own.lake)
    // Sent buffers are given up; the worker's memo must not be among them.
    const again = answer({ id: 2, kind: 'hydrology', seed, dials: DEFAULT_DIALS })
    if (again.kind !== 'hydrology') throw new Error('wrong kind')
    for (const buffer of transferables(result)) expect(transferables(again)).not.toContain(buffer)
  })
})

describe('the patch job', () => {
  it('brings the water sheet made in the worker, sent with the rest', () => {
    const seed = parseSeed('83tzj46')
    if (seed === undefined) throw new Error('test seed did not parse')
    // A coarse patch of a temperate world: sea somewhere on it.
    const key = { face: 2, level: 2, x: 1, y: 1 } as const
    const result = answer({ id: 3, kind: 'patch', seed, dials: DEFAULT_DIALS, key, segments: 8 })
    if (result.kind !== 'patch') throw new Error('wrong kind')
    const { patch } = result
    expect(patch.hasSea).toBe(true)
    expect(patch.sea !== undefined).toBe(patch.hasSea)
    if (patch.sea === undefined) return
    expect(patch.sea.positions.length).toBe(patch.positions.length)
    expect(patch.sea.depth.length).toBe(patch.positions.length / 3)
    expect(transferables(result)).toContain(patch.sea.depth.buffer)
    // Each skirt vertex takes the water of the grid vertex it hangs from:
    // the one with its own direction (what string keys matched before).
    const count = patch.positions.length / 3
    const side = 9
    const unit = (v: number): [number, number, number] => {
      const x = patch.positions[v * 3] ?? 0
      const y = patch.positions[v * 3 + 1] ?? 0
      const z = patch.positions[v * 3 + 2] ?? 0
      const l = Math.hypot(x, y, z)
      return [x / l, y / l, z / l]
    }
    for (let v = side * side; v < count; v += 1) {
      const [x, y, z] = unit(v)
      let from = -1
      for (let g = 0; g < side * side && from < 0; g += 1) {
        const [a, b, c] = unit(g)
        if (Math.abs(a - x) + Math.abs(b - y) + Math.abs(c - z) < 1e-6) from = g
      }
      expect(from).toBeGreaterThanOrEqual(0)
      expect(patch.sea.depth[v]).toBe(patch.sea.depth[from])
      expect(patch.sea.coarseDepth[v]).toBe(patch.sea.coarseDepth[from])
      expect(patch.sea.inland[v]).toBe(patch.sea.inland[from])
    }
  })
})
