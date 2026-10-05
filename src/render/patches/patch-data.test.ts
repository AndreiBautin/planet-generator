import { describe, expect, it } from 'vitest'

import { createPlanet } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

import { patchIndex, samplePatch, vertexCount } from './patch-data'

const parsed = parseSeed('2257afq')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed
const planet = createPlanet(seed)
const key = { face: 4, level: 3, x: 2, y: 5 } as const
const segments = 8
const patch = samplePatch(planet, key, segments)

const at = (array: Float32Array, vertex: number): readonly [number, number, number] => [
  array[vertex * 3] ?? 0,
  array[vertex * 3 + 1] ?? 0,
  array[vertex * 3 + 2] ?? 0,
]

describe('samplePatch', () => {
  it('gives every vertex a position, a normal and a colour', () => {
    const count = vertexCount(segments)
    expect(patch.positions).toHaveLength(count * 3)
    expect(patch.normals).toHaveLength(count * 3)
    expect(patch.colours).toHaveLength(count * 3)
    expect(patch.positions.every(Number.isFinite)).toBe(true)
  })

  it('lights the ground from outside: normals are unit length and point away from the centre', () => {
    for (let vertex = 0; vertex < (segments + 1) ** 2; vertex += 1) {
      const n = at(patch.normals, vertex)
      const p = at(patch.positions, vertex)
      expect(Math.hypot(...n)).toBeCloseTo(1, 5)
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeGreaterThan(0.5)
    }
  })

  it('hangs the skirt below the edge it belongs to', () => {
    const grid = (segments + 1) ** 2
    // The first skirt vertex is under the patch's first corner.
    const edge = Math.hypot(...at(patch.positions, 0))
    const skirt = Math.hypot(...at(patch.positions, grid))
    expect(skirt).toBeLessThan(edge)
    expect(edge - skirt).toBeLessThan(0.05)
  })

  it('is the same patch every time it is asked for', () => {
    const again = samplePatch(planet, key, segments)
    expect(Array.from(again.positions)).toEqual(Array.from(patch.positions))
  })

  it('agrees with its neighbour along the edge they share', () => {
    const right = samplePatch(planet, { ...key, x: key.x + 1 }, segments)
    const side = segments + 1
    for (let j = 0; j <= segments; j += 1) {
      const mine = at(patch.positions, j * side + segments)
      const theirs = at(right.positions, j * side)
      for (let axis = 0; axis < 3; axis += 1) expect(mine[axis]).toBeCloseTo(theirs[axis] ?? 0, 6)
      const mineN = at(patch.normals, j * side + segments)
      const theirsN = at(right.normals, j * side)
      for (let axis = 0; axis < 3; axis += 1) expect(mineN[axis]).toBeCloseTo(theirsN[axis] ?? 0, 4)
    }
  })
})

describe('patchIndex', () => {
  it('names only vertices the patch has, and is shared between calls', () => {
    const index = patchIndex(segments)
    expect(Math.max(...index)).toBeLessThan(vertexCount(segments))
    expect(index.length % 3).toBe(0)
    expect(patchIndex(segments)).toBe(index)
  })
})
