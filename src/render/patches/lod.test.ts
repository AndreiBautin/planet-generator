import { describe, expect, it } from 'vitest'

import {
  childrenOf,
  directionOn,
  keyOf,
  neighboursOf,
  parentOf,
  patchAt,
  patchUv,
  ROOTS,
  type Vec3,
} from './cube'
import {
  ancestorAt,
  centreOf,
  featureTiles,
  selectLeaves,
  UNSEEN_LEVEL,
  type LodParams,
  type ViewCone,
} from './lod'

const params: LodParams = { segments: 32, threshold: 0.006, maxLevel: 9, peak: 0.06 }

/** Each leaf covers a quarter of its parent, so the leaves of a full tiling sum to six faces. */
const coverage = (leaves: readonly { level: number }[]): number =>
  leaves.reduce((sum, leaf) => sum + 4 ** -leaf.level, 0)

const scale = (v: Vec3, by: number): Vec3 => [v[0] * by, v[1] * by, v[2] * by]

describe('the cube', () => {
  it('puts every face coordinate on the unit sphere', () => {
    for (const root of ROOTS) {
      for (const [s, t] of [
        [0, 0],
        [0.5, 0.5],
        [1, 0.3],
      ] as const) {
        const [u, v] = patchUv(root, s, t)
        const d = directionOn(root.face, u, v)
        expect(Math.hypot(...d)).toBeCloseTo(1, 10)
      }
    }
  })

  it('meets at the edges: a face corner is the same point from every face that shares it', () => {
    // The corner (1, 1, 1) direction is shared by +X, +Y and +Z.
    const expected = 1 / Math.sqrt(3)
    const fromX = directionOn(0, -1, 1)
    const fromY = directionOn(2, 1, -1)
    const fromZ = directionOn(4, 1, 1)
    for (const point of [fromX, fromY, fromZ]) {
      for (const component of point) expect(component).toBeCloseTo(expected, 10)
    }
  })

  it('finds the patch holding a direction, the inverse of laying one out', () => {
    for (const key of [
      { face: 0, level: 3, x: 2, y: 5 },
      { face: 4, level: 6, x: 63, y: 0 },
      { face: 5, level: 1, x: 0, y: 1 },
    ] as const) {
      const [u, v] = patchUv(key, 0.5, 0.5)
      expect(patchAt(directionOn(key.face, u, v), key.level)).toEqual(key)
    }
  })

  it('finds each neighbour, across a face edge too, and each neighbour finds it back', () => {
    for (const key of [
      { face: 4, level: 3, x: 3, y: 3 },
      { face: 4, level: 3, x: 0, y: 7 },
      { face: 2, level: 2, x: 3, y: 0 },
    ] as const) {
      const neighbours = neighboursOf(key)
      expect(new Set(neighbours.map(keyOf)).size).toBe(4)
      for (const neighbour of neighbours) {
        expect(neighbour.level).toBe(key.level)
        expect(neighboursOf(neighbour).map(keyOf)).toContain(keyOf(key))
      }
    }
  })

  it('splits a patch into four that point back to it', () => {
    const key = { face: 3, level: 2, x: 1, y: 3 } as const
    for (const child of childrenOf(key)) expect(parentOf(child)).toEqual(key)
    expect(new Set(childrenOf(key).map(keyOf)).size).toBe(4)
  })
})

describe('selectLeaves', () => {
  it('draws the six faces whole from far away', () => {
    expect(selectLeaves([0, 0, 60], params)).toHaveLength(6)
  })

  it('always tiles the sphere exactly once, however close the camera is', () => {
    for (const distance of [6, 3.2, 1.5, 1.05, 1.01]) {
      const leaves = selectLeaves(scale([0.3, 0.8, 0.52], distance), params)
      expect(coverage(leaves)).toBeCloseTo(6, 10)
      expect(new Set(leaves.map(keyOf)).size).toBe(leaves.length)
    }
  })

  it('splits finest under the camera and leaves the far side coarse', () => {
    const under: Vec3 = [0, 0, 1]
    const leaves = selectLeaves(scale(under, 1.02), params)
    const deepest = Math.max(...leaves.map((leaf) => leaf.level))
    const farSide = leaves.filter((leaf) => leaf.face === 5)
    expect(deepest).toBeGreaterThanOrEqual(5)
    expect(Math.max(...farSide.map((leaf) => leaf.level))).toBeLessThanOrEqual(1)
  })

  it('never splits past the deepest level asked for', () => {
    const leaves = selectLeaves([0, 0, 1.0005], { ...params, maxLevel: 4 })
    expect(Math.max(...leaves.map((leaf) => leaf.level))).toBe(4)
  })

  it('draws fewer patches at a coarser threshold', () => {
    const camera: Vec3 = [0, 0, 1.3]
    const fine = selectLeaves(camera, params).length
    const coarse = selectLeaves(camera, { ...params, threshold: 0.02 }).length
    expect(coarse).toBeLessThan(fine)
  })

  it('splits the ground in view and leaves what is behind the camera coarse', () => {
    // Low over +z, looking along +x.
    const camera: Vec3 = [0, 0, 1.016]
    const view: ViewCone = { forward: [0.97, 0, -0.22], halfAngle: 0.6 }
    const all = selectLeaves(camera, params)
    const looking = selectLeaves(camera, params, view)
    expect(looking.length).toBeLessThan(all.length * 0.6)
    expect(coverage(looking)).toBeCloseTo(6, 10)
    // Ahead stays fine; behind stops at the unseen level.
    const behind = looking.filter((leaf) => {
      const [u, v] = patchUv(leaf, 0.5, 0.5)
      return directionOn(leaf.face, u, v)[0] < -0.2
    })
    expect(Math.max(...behind.map((leaf) => leaf.level))).toBeLessThanOrEqual(UNSEEN_LEVEL)
    const ahead = looking.filter((leaf) => {
      const [u, v] = patchUv(leaf, 0.5, 0.5)
      const d = directionOn(leaf.face, u, v)
      return d[0] > 0.02 && d[0] < 0.08 && Math.abs(d[1]) < 0.02
    })
    expect(Math.max(...ahead.map((leaf) => leaf.level))).toBeGreaterThan(UNSEEN_LEVEL + 2)
  })

  it('finds the coarser patch containing a fine one', () => {
    const key = { face: 2, level: 6, x: 45, y: 13 } as const
    expect(ancestorAt(key, 4)).toEqual({ face: 2, level: 4, x: 11, y: 3 })
    expect(ancestorAt(key, 6)).toBe(key)
  })

  describe('featureTiles', () => {
    const camera: Vec3 = [0, 0, 1.016]

    it('finds nothing from orbit', () => {
      expect(featureTiles([0, 0, 3.2], 7, 0.1)).toEqual([])
    })

    it('finds tiles of one level, within range, including the one underneath', () => {
      const tiles = featureTiles(camera, 7, 0.08)
      expect(tiles.length).toBeGreaterThan(0)
      for (const tile of tiles) {
        expect(tile.level).toBe(7)
        const c = centreOf(tile)
        expect(Math.hypot(camera[0] - c[0], camera[1] - c[1], camera[2] - c[2])).toBeLessThan(
          0.08 + 0.02,
        )
      }
      const nearest = Math.min(
        ...tiles.map((tile) => {
          const c = centreOf(tile)
          return Math.hypot(c[0], c[1], c[2] - 1)
        }),
      )
      expect(nearest).toBeLessThan(0.01)
    })

    it('leaves out tiles behind the camera', () => {
      const view: ViewCone = { forward: [0.97, 0, -0.22], halfAngle: 0.6 }
      const all = featureTiles(camera, 7, 0.08)
      const ahead = featureTiles(camera, 7, 0.08, view)
      expect(ahead.length).toBeLessThan(all.length)
      for (const tile of ahead) expect(centreOf(tile)[0]).toBeGreaterThan(-0.03)
    })

    it('keeps every tile in view, wherever the camera is: a parent behind the eye cannot hide its children ahead', () => {
      // Flying low along the ground, the camera crosses from one big patch
      // into the next. Culling a whole patch by where its centre lies hid
      // every tile in it that was right in front of the eye — the forest and
      // the ground's detail vanished in a single frame.
      const range = 0.12
      const half = 0.6
      const unit = (v: Vec3): Vec3 => scale(v, 1 / Math.hypot(...v))
      for (let step = 0; step < 40; step += 1) {
        const along = -0.3 + step * 0.015
        const under = unit([along, 0.2, 1])
        const eye = scale(under, 1.016)
        const ahead = unit([1, 0, -along])
        const forward = unit([
          ahead[0] - under[0] * 0.2,
          ahead[1] - under[1] * 0.2,
          ahead[2] - under[2] * 0.2,
        ])
        const view: ViewCone = { forward, halfAngle: half }
        const found = new Set(featureTiles(eye, 7, range, view).map(keyOf))
        for (const tile of featureTiles(eye, 7, range)) {
          const c = centreOf(tile)
          const d: Vec3 = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]]
          const gap = Math.hypot(...d)
          const off = Math.acos((d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2]) / gap)
          // Squarely in view: its centre well inside the cone.
          if (off < half * 0.8) expect(found.has(keyOf(tile))).toBe(true)
        }
      }
    })
  })
})
