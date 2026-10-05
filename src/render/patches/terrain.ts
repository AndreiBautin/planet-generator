import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import type { Builder } from '../builder'
import { SEA_RADIUS } from '../water'
import { keyOf, parentOf, ROOTS, type PatchKey, type Vec3 } from './cube'
import { aheadOf, ancestorAt, centreOf, selectLeaves, type LodParams, type ViewCone } from './lod'
import { Flora, type FloraOptions } from './flora'
import { patchIndex, type PatchData } from './patch-data'

/**
 * A planet's ground, streamed: asks the builder for the patches the camera
 * needs, draws each as it arrives, and until then draws the finest ancestor
 * it already has. The six whole faces are fetched first and never let go,
 * so there is always a planet to draw, however coarse.
 */
export interface TerrainOptions extends LodParams {
  /** The features standing on the ground near the camera. */
  readonly flora: FloraOptions
  /** Requests out at once; more is faster to fill and slower to change its mind. */
  readonly inFlight: number
  /** Patches kept after they stop being drawn, for flying back over them. */
  readonly cached: number
}

export interface TerrainMaterials {
  readonly ground: THREE.Material
  readonly water: THREE.Material
}

interface Entry {
  readonly key: PatchKey
  node: THREE.Group | undefined
  requested: boolean
  usedAt: number
}

export class Terrain {
  readonly group = new THREE.Group()
  private readonly entries = new Map<string, Entry>()
  private readonly index: Uint16Array
  private waiting = 0
  private frame = 0
  private disposed = false

  private readonly world: Planet
  private readonly builder: Builder
  private readonly options: TerrainOptions
  private readonly materials: TerrainMaterials
  private readonly flora: Flora

  constructor(
    world: Planet,
    builder: Builder,
    options: TerrainOptions,
    materials: TerrainMaterials,
  ) {
    this.world = world
    this.builder = builder
    this.options = options
    this.materials = materials
    // Features ride with the ground: a child of its group, they turn with the
    // planet and grow with it as it is born.
    this.flora = new Flora(world, builder, options.flora)
    this.group.add(this.flora.group)
    // One array of triangles for every patch; each geometry wraps it in an
    // attribute of its own, because disposing a geometry frees its index's
    // GPU buffer and a shared attribute would be freed from under the rest.
    this.index = patchIndex(options.segments)
    for (const root of ROOTS) this.request(root)
  }

  /** Whether the six whole faces are in, so the planet can be shown at all. */
  get ready(): boolean {
    return ROOTS.every((root) => this.entries.get(keyOf(root))?.node !== undefined)
  }

  /** Patches waiting on the builder; nought once the view has filled in. */
  get pending(): number {
    return this.waiting
  }

  /**
   * Choose and draw the patches for a camera at this point in the planet's
   * own frame, looking along `view` when it is known.
   */
  update(camera: Vec3, view?: ViewCone): void {
    if (this.disposed) return
    this.frame += 1
    this.flora.update(camera, view)
    const leaves = selectLeaves(camera, this.options, view)
    const shown = new Set<string>()

    // Refine from coarse to fine: where a leaf is drawn by a stand-in, ask
    // for the next level down from the stand-in rather than for the leaf
    // itself. Diving from orbit, the leaves are seven levels below what is
    // on screen; asking for them directly left the coarse faces up until the
    // finest ground arrived all at once, and a step at a time sharpens the
    // view on the way down. Nearest first: the ground under the camera is
    // what somebody is looking at.
    const wanted = new Map<string, { readonly key: PatchKey; readonly distance: number }>()
    for (const leaf of leaves) {
      let drawn = -1
      for (let level = leaf.level; level >= 0; level -= 1) {
        if (this.entries.get(keyOf(ancestorAt(leaf, level)))?.node !== undefined) {
          drawn = level
          break
        }
      }
      if (drawn === leaf.level) continue
      const next = ancestorAt(leaf, drawn + 1)
      const name = keyOf(next)
      if (this.entries.get(name)?.requested === true || wanted.has(name)) continue
      wanted.set(name, { key: next, distance: aheadOf(centreOf(next), camera, view) })
    }
    const queue = [...wanted.values()].sort((a, b) => a.distance - b.distance)
    for (const { key } of queue) {
      if (this.waiting >= this.options.inFlight) break
      this.request(key)
    }

    for (const leaf of leaves) {
      // The finest patch already in that covers this leaf.
      let key: PatchKey | undefined = leaf
      while (key !== undefined) {
        const entry = this.entries.get(keyOf(key))
        if (entry?.node !== undefined) {
          shown.add(keyOf(key))
          entry.usedAt = this.frame
          break
        }
        key = parentOf(key)
      }
    }
    // A coarse stand-in already covers its descendants; drawing both would
    // put two surfaces in one place.
    for (const name of [...shown]) {
      const entry = this.entries.get(name)
      let parent = entry === undefined ? undefined : parentOf(entry.key)
      while (parent !== undefined) {
        if (shown.has(keyOf(parent))) {
          shown.delete(name)
          break
        }
        parent = parentOf(parent)
      }
    }

    for (const [name, entry] of this.entries) {
      if (entry.node !== undefined) entry.node.visible = shown.has(name)
    }
    this.evict(shown)
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) if (entry.node !== undefined) free(entry.node)
    this.entries.clear()
    this.materials.ground.dispose()
    this.materials.water.dispose()
    this.flora.dispose()
  }

  private request(key: PatchKey): void {
    const name = keyOf(key)
    const existing = this.entries.get(name)
    if (existing?.requested === true) return
    const entry: Entry = existing ?? { key, node: undefined, requested: true, usedAt: this.frame }
    entry.requested = true
    this.entries.set(name, entry)
    this.waiting += 1
    void this.builder
      .patch(this.world.seed, this.world.dials, key, this.options.segments)
      .then((patch) => {
        this.waiting -= 1
        // A planet replaced while its patches were being made: drop them.
        if (this.disposed || this.entries.get(name) !== entry) return
        entry.node = this.nodeFor(patch)
        entry.node.visible = false
        this.group.add(entry.node)
      })
  }

  private nodeFor(patch: PatchData): THREE.Group {
    const node = new THREE.Group()
    const ground = new THREE.BufferGeometry()
    ground.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3))
    ground.setAttribute('normal', new THREE.BufferAttribute(patch.normals, 3))
    ground.setAttribute('color', new THREE.BufferAttribute(patch.colours, 3))
    ground.setAttribute('pattern', new THREE.BufferAttribute(patch.pattern, 4))
    ground.setIndex(new THREE.BufferAttribute(this.index, 1))
    ground.computeBoundingSphere()
    const land = new THREE.Mesh(ground, this.materials.ground)
    land.receiveShadow = true
    land.castShadow = true
    node.add(land)

    if (patch.hasSea) {
      // The sea over this patch: the same grid laid on the smooth sphere at
      // sea level, so it shares the index and meets its neighbours' water.
      const count = patch.positions.length / 3
      const positions = new Float32Array(count * 3)
      const normals = new Float32Array(count * 3)
      // How deep the floor lies under the sea here: foam where it is nought,
      // lighter water where it is little.
      const depth = new Float32Array(count)
      for (let vertex = 0; vertex < count; vertex += 1) {
        const x = patch.positions[vertex * 3] ?? 0
        const y = patch.positions[vertex * 3 + 1] ?? 0
        const z = patch.positions[vertex * 3 + 2] ?? 1
        const length = Math.hypot(x, y, z) || 1
        depth[vertex] = SEA_RADIUS - length
        normals[vertex * 3] = x / length
        normals[vertex * 3 + 1] = y / length
        normals[vertex * 3 + 2] = z / length
        positions[vertex * 3] = (x / length) * SEA_RADIUS
        positions[vertex * 3 + 1] = (y / length) * SEA_RADIUS
        positions[vertex * 3 + 2] = (z / length) * SEA_RADIUS
      }
      const water = new THREE.BufferGeometry()
      water.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      water.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      water.setAttribute('depth', new THREE.BufferAttribute(depth, 1))
      water.setIndex(new THREE.BufferAttribute(this.index, 1))
      water.computeBoundingSphere()
      const sea = new THREE.Mesh(water, this.materials.water)
      sea.renderOrder = 1
      sea.receiveShadow = true
      node.add(sea)
    }
    return node
  }

  /** Let go of the least recently drawn patches once there are too many. */
  private evict(shown: ReadonlySet<string>): void {
    const held = [...this.entries.values()].filter((entry) => entry.node !== undefined)
    if (held.length <= this.options.cached) return
    const spare = held
      .filter((entry) => entry.key.level > 0 && !shown.has(keyOf(entry.key)))
      .sort((a, b) => a.usedAt - b.usedAt)
    for (const entry of spare.slice(0, held.length - this.options.cached)) {
      if (entry.node !== undefined) {
        this.group.remove(entry.node)
        free(entry.node)
      }
      this.entries.delete(keyOf(entry.key))
    }
  }
}

/**
 * Geometry only: the materials and the index are shared and outlive a patch,
 * and so are the plant models — an instanced mesh frees its own instances
 * and leaves its model for the next patch.
 */
function free(node: THREE.Group): void {
  node.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) {
      child.dispose()
      return
    }
    if (child instanceof THREE.Mesh) {
      const geometry: unknown = child.geometry
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
    }
  })
}
