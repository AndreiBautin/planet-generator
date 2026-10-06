import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { createPlanet } from '@/generation/planet'
import { parseSeed } from '@/generation/seed'

import { childrenOf, type PatchKey } from './cube'
import { forestFor, TREE_COARSEST, TREE_LEVEL } from './forest'
import { samplePatch } from './patch-data'

const seed = parseSeed('83tzj46')
if (seed === undefined) throw new Error('test seed must parse')
const planet = createPlanet(seed)
const tints = { conifer: new THREE.Color(0.2, 0.4, 0.2), broadleaf: new THREE.Color(0.3, 0.5, 0.2) }
const material = new THREE.MeshBasicMaterial()

/** Every tree a patch carries, by where it stands: its chance, and whether its parent has it too. */
function treesOf(key: PatchKey) {
  const trees = new Map<string, { readonly chance: number; readonly shared: boolean }>()
  for (const mesh of forestFor(
    samplePatch(planet, key, 32),
    key.level,
    32,
    material,
    material,
    tints,
  )) {
    const fine = mesh.geometry.getAttribute('treeFine')
    const fate = mesh.geometry.getAttribute('treeFate')
    const wood = mesh.geometry.getAttribute('treeWood')
    const count = (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount
    for (let k = 0; k < count; k += 1) {
      const name = [fine.getX(k), fine.getY(k), fine.getZ(k)].map((v) => v.toFixed(6)).join(',')
      trees.set(name, { chance: wood.getX(k), shared: fate.getY(k) > 0.5 })
    }
  }
  return trees
}

/** A wooded patch at a level, found by search rather than assumed. */
function wooded(level: number): PatchKey {
  const side = 2 ** level
  for (let face = 0; face < 6; face += 1) {
    for (let x = 1; x < side; x += Math.max(1, Math.floor(side / 7))) {
      for (let y = 1; y < side; y += Math.max(1, Math.floor(side / 7))) {
        const key = { face, level, x, y } as PatchKey
        if (treesOf(key).size > 40) return key
      }
    }
  }
  throw new Error(`no wooded patch at level ${String(level)}`)
}

describe('forestFor', () => {
  it('carries trees only between the coarsest wooded level and the tree level', () => {
    const key = wooded(TREE_LEVEL)
    const above = { ...key, level: TREE_COARSEST - 1, x: key.x >> 3, y: key.y >> 3 }
    const below = childrenOf(key)[0]
    expect(treesOf(above).size).toBe(0)
    if (below !== undefined) expect(treesOf(below).size).toBe(0)
  })

  it('makes the same decision about a tree in a patch and in its parent', () => {
    // What keeps a change of level from changing the picture: a tree the
    // parent shares stands at the same spot with the same chance in both.
    const parent = wooded(TREE_LEVEL - 1)
    const above = treesOf(parent)
    let shared = 0
    for (const child of childrenOf(parent)) {
      for (const [where, tree] of treesOf(child)) {
        if (!tree.shared) continue
        const same = above.get(where)
        if (same === undefined) continue
        expect(same.chance).toBeCloseTo(tree.chance, 6)
        shared += 1
      }
    }
    expect(shared).toBeGreaterThan(5)
  })
})
