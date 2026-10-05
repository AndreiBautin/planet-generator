import { describe, expect, it } from 'vitest'

import { createPlanet } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

import { groundRadiusAt, patchIndex, samplePatch, vertexCount } from './patch-data'
import { SEA_RADIUS } from '../water'

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

  it("gives every vertex the parent's position, so a change of level can slide rather than jump", () => {
    const side = segments + 1
    const coarse = (vertex: number): readonly [number, number, number] => [
      patch.coarsePositions[vertex * 4] ?? 0,
      patch.coarsePositions[vertex * 4 + 1] ?? 0,
      patch.coarsePositions[vertex * 4 + 2] ?? 0,
    ]
    // A vertex the parent has too is where it was.
    expect(coarse(2 * side + 2)).toEqual(at(patch.positions, 2 * side + 2))
    // One between two of the parent's lies on the line joining them.
    const left = at(patch.positions, 2 * side + 2)
    const right = at(patch.positions, 2 * side + 4)
    const middle = coarse(2 * side + 3)
    for (let axis = 0; axis < 3; axis += 1) {
      expect(middle[axis]).toBeCloseTo(((left[axis] ?? 0) + (right[axis] ?? 0)) / 2, 6)
    }
    expect(patch.coarsePositions[3]).toBe(key.level)
    for (let vertex = 0; vertex < side * side; vertex += 1) {
      const n: readonly [number, number, number] = [
        patch.coarseNormals[vertex * 3] ?? 0,
        patch.coarseNormals[vertex * 3 + 1] ?? 0,
        patch.coarseNormals[vertex * 3 + 2] ?? 0,
      ]
      expect(Math.hypot(...n)).toBeCloseTo(1, 5)
    }
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

describe('groundRadiusAt', () => {
  it('puts the ground where the patches draw it, and never under the sea', () => {
    for (let vertex = 0; vertex < (segments + 1) ** 2; vertex += 7) {
      const p = at(patch.positions, vertex)
      const drawn = Math.hypot(...p)
      expect(groundRadiusAt(planet, p)).toBeCloseTo(Math.max(SEA_RADIUS, drawn), 5)
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
