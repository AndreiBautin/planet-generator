import { describe, expect, it } from 'vitest'

import { createPlanet, type Surface } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

import {
  canopyRadiusAt,
  groundOf,
  groundRadiusAt,
  patchIndex,
  quarterIndex,
  samplePatch,
  seaFogOver,
  vertexCount,
} from './patch-data'
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

describe('the water past a shore', () => {
  // A coast of seed 83tzj46 where the ramp up from the sea floor leaves
  // the lowest land under the sea's surface (surface-data.ts).
  const coastSeed = parseSeed('83tzj46')
  if (coastSeed === undefined) throw new Error('coast seed must parse')
  const coastSegments = 32
  const coast = samplePatch(
    createPlanet(coastSeed),
    { face: 4, level: 5, x: 19, y: 12 },
    coastSegments,
  )
  const side = coastSegments + 1
  const radius = (vertex: number): number => Math.hypot(...at(coast.positions, vertex))

  it('marks dry only the vertices the water does not cover', () => {
    for (let vertex = 0; vertex < side * side; vertex += 1) {
      if ((coast.dry[vertex] ?? 0) === 0)
        expect(coast.water[vertex]).toBeGreaterThan(radius(vertex))
    }
  })

  it('holds the sheet level over land sunk below the sea beside it, rather than tilting it into the beach', () => {
    let sunk = 0
    for (let j = 0; j < side; j += 1) {
      for (let i = 0; i < side; i += 1) {
        const vertex = j * side + i
        if ((coast.dry[vertex] ?? 0) === 0 || radius(vertex) >= SEA_RADIUS) continue
        let bySea = false
        for (let dj = -1; dj <= 1; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            const ni = i + di
            const nj = j + dj
            if (ni < 0 || nj < 0 || ni >= side || nj >= side) continue
            const near = nj * side + ni
            if (
              (coast.dry[near] ?? 0) === 0 &&
              Math.abs((coast.water[near] ?? 0) - SEA_RADIUS) < 1e-6
            )
              bySea = true
          }
        }
        if (!bySea) continue
        sunk += 1
        // Dropped under its own ground, the sheet ran down from the sea
        // into the beach and stood over a coastal plain in glassy panes.
        expect(coast.water[vertex]).toBeCloseTo(SEA_RADIUS, 6)
      }
    }
    expect(sunk).toBeGreaterThan(0)
  })
})

describe('canopyRadiusAt', () => {
  it('stands over the ground, never under it, and over the trees where a wood grows', () => {
    let wooded = 0
    for (let k = 0; k < 400; k += 1) {
      const a = k * 2.399963
      const z = 1 - (2 * (k + 0.5)) / 400
      const r = Math.sqrt(1 - z * z)
      const direction = [Math.cos(a) * r, Math.sin(a) * r, z] as const
      const ground = groundRadiusAt(planet, direction)
      const canopy = canopyRadiusAt(planet, direction)
      expect(canopy).toBeGreaterThanOrEqual(ground)
      // A tree at the finest level stands up to 1.4 × 0.0015.
      if (canopy - ground > 0.0021) wooded += 1
    }
    // The glide flew through the pines when it kept off the ground alone.
    expect(wooded).toBeGreaterThan(0)
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

describe('quarterIndex', () => {
  it('splits the patch into four quarters that are, between them, exactly the whole', () => {
    const triangles = (index: Uint16Array): string[] => {
      const out: string[] = []
      for (let t = 0; t < index.length; t += 3) {
        out.push([index[t], index[t + 1], index[t + 2]].join(','))
      }
      return out
    }
    const whole = triangles(patchIndex(8)).sort()
    const parts = [0, 1, 2, 3].flatMap((q) => triangles(quarterIndex(8, q))).sort()
    expect(parts).toEqual(whole)
  })
})

describe('groundOf', () => {
  const land = (warmth: number, moisture: number, height = 0.1) =>
    ({ height, biome: 'land', colour: [0.3, 0.5, 0.2], moisture, warmth }) as const
  const open = { canopy: 0, sand: 0, snow: 0, stone: 0 }

  it('lays tundra on cold land, savanna on warm dry land, and neither where it is temperate', () => {
    const [, coldSavanna, coldTundra] = groundOf(planet, land(-0.28, 0.5), 0, open)
    expect(coldTundra).toBeGreaterThan(0.8)
    expect(coldSavanna).toBe(0)
    const [, warmSavanna, warmTundra] = groundOf(planet, land(0.6, 0.15), 0, open)
    expect(warmSavanna).toBeGreaterThan(0.8)
    expect(warmTundra).toBe(0)
    const [, mildSavanna, mildTundra] = groundOf(planet, land(0.05, 0.7), 0, open)
    expect(mildSavanna + mildTundra).toBeLessThan(0.1)
  })

  it('lays salt only on the driest low, flat ground', () => {
    expect(groundOf(planet, land(0.5, 0.05, 0.01), 0, open)[3]).toBeGreaterThan(0.8)
    expect(groundOf(planet, land(0.5, 0.05, 0.3), 0, open)[3]).toBe(0)
    expect(groundOf(planet, land(0.5, 0.6, 0.01), 0, open)[3]).toBe(0)
  })

  it('lays nothing under the sea', () => {
    expect(groundOf(planet, land(0.5, 0.05, -0.1), 0, open)).toEqual([0, 0, 0, 0])
  })
})

describe('seaFogOver', () => {
  const sea = (height: number, warmth: number): Surface => ({
    height,
    warmth,
    biome: 'shallow',
    colour: [0, 0, 0],
    moisture: 0,
  })

  it('lies over cool water along a coast', () => {
    expect(seaFogOver(sea(-0.005, -0.2))).toBeGreaterThan(0.001)
  })

  it('leaves the open ocean, the warm seas and the pack ice clear', () => {
    // A depth under the surface draws nothing.
    expect(seaFogOver(sea(-0.08, -0.2))).toBeLessThan(0)
    expect(seaFogOver(sea(-0.005, 0.4))).toBeLessThan(0)
    expect(seaFogOver(sea(-0.005, -0.6))).toBeLessThan(0)
  })
})
