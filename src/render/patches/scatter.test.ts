import { describe, expect, it } from 'vitest'

import { createPlanet } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'
import { FEATURES } from '@/generation/features'

import { childrenOf, type PatchKey } from './cube'
import { groundRadiusAt } from './patch-data'
import { SEA_RADIUS } from '../water'
import { scatterPatch, STRIDE, TREE_LEVEL, treesKept, type Scatter } from './scatter'

const SCATTER_LEVEL = TREE_LEVEL + 2

const parsed = parseSeed('2257afq')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed
const planet = createPlanet(seed)

/** Every plant as a string of its numbers, to compare sets. */
const plants = (scatter: Scatter): string[] =>
  FEATURES.flatMap((plant) => {
    const data = scatter[plant]
    if (data === undefined) return []
    const out: string[] = []
    for (let at = 0; at < data.length; at += STRIDE) {
      out.push(
        `${plant}:${Array.from(data.slice(at, at + STRIDE))
          .map((n) => n.toFixed(6))
          .join(',')}`,
      )
    }
    return out
  }).sort()

/** A patch with land on it, found by search rather than assumed. */
function landPatch(): PatchKey {
  const side = 2 ** SCATTER_LEVEL
  for (let x = 0; x < side; x += 37) {
    for (let y = 0; y < side; y += 41) {
      const key: PatchKey = { face: 4, level: SCATTER_LEVEL, x, y }
      if (plants(scatterPatch(planet, key)).length > 10) return key
    }
  }
  throw new Error('no land patch found on face 4')
}
const key = landPatch()

describe('scatterPatch', () => {
  it('scatters nothing on a coarse patch', () => {
    expect(scatterPatch(planet, { face: 4, level: TREE_LEVEL - 1, x: 3, y: 3 })).toEqual({})
  })

  it('is the same plants every time', () => {
    expect(plants(scatterPatch(planet, key))).toEqual(plants(scatterPatch(planet, key)))
  })

  it('keeps every tree where it was when the ground refines', () => {
    const whole = plants(scatterPatch(planet, key))
    const quarters = childrenOf(key).flatMap((child) => plants(scatterPatch(planet, child)))
    expect(quarters.sort()).toEqual(whole)
  })

  it('stands features on the ground, or on the sea for a floe', () => {
    for (const plant of FEATURES) {
      const data = scatterPatch(planet, key)[plant]
      if (data === undefined) continue
      for (let at = 0; at < data.length; at += STRIDE) {
        const p = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0] as const
        const radius = Math.hypot(...p)
        if (plant === 'floe') {
          expect(radius).toBeCloseTo(SEA_RADIUS, 4)
          continue
        }
        expect(radius).toBeLessThanOrEqual(groundRadiusAt(planet, p))
        expect(groundRadiusAt(planet, p) - radius).toBeLessThan(0.001)
      }
    }
  })

  it('gives neighbouring plants of a kind their own size and shade', () => {
    const scatter = scatterPatch(planet, key)
    const kind = FEATURES.find((plant) => (scatter[plant]?.length ?? 0) >= STRIDE * 5)
    if (kind === undefined) throw new Error('expected several of one kind')
    const data = scatter[kind] ?? new Float32Array()
    const sizes = new Set<number>()
    const shades = new Set<number>()
    for (let at = 0; at < data.length; at += STRIDE) {
      sizes.add(Number((data[at + 3] ?? 0).toFixed(4)))
      shades.add(Number((data[at + 6] ?? 0).toFixed(4)))
    }
    expect(sizes.size).toBeGreaterThan(3)
    expect(shades.size).toBeGreaterThan(3)
  })

  it('carries in a coarse patch only trees its children carry too, at the same spots', () => {
    // What makes a patch giving way to its children invisible: the coarse
    // patch's trees are the low-ranked few of the same trees.
    const coarse = plants(scatterPatch(planet, key, 0.3))
    const fine = new Set(
      childrenOf(key).flatMap((child) => plants(scatterPatch(planet, child, 0.6))),
    )
    expect(coarse.length).toBeGreaterThan(0)
    for (const plant of coarse) expect(fine.has(plant)).toBe(true)
    expect(fine.size).toBeGreaterThan(coarse.length)
  })

  it('asks a finer level for at least as many trees as a coarser one, and the finest for all', () => {
    let last = 0
    for (let level = TREE_LEVEL; level <= 9; level += 1) {
      const keep = treesKept(level, 9, 0.012, 32 * 0.006 * 3)
      expect(keep).toBeGreaterThanOrEqual(last)
      last = keep
    }
    expect(last).toBe(1)
    expect(treesKept(TREE_LEVEL - 1, 9, 0.012, 0.5)).toBe(0)
    expect(treesKept(9, 9, 0, 0.5)).toBe(0)
  })
})
