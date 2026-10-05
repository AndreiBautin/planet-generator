import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import type { Builder } from '../builder'
import { SEA_RADIUS } from '../water'
import { keyOf, parentOf, ROOTS, type PatchKey, type Vec3 } from './cube'
import { centreOf, selectLeaves, type LodParams } from './lod'
import { patchIndex, type PatchData } from './patch-data'

/**
 * A planet's ground, streamed: asks the builder for the patches the camera
 * needs, draws each as it arrives, and until then draws the finest ancestor
 * it already has. The six whole faces are fetched first and never let go,
 * so there is always a planet to draw, however coarse.
 */
export interface TerrainOptions extends LodParams {
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

  /** Choose and draw the patches for a camera at this point in the planet's own frame. */
  update(camera: Vec3): void {
    if (this.disposed) return
    this.frame += 1
    const leaves = selectLeaves(camera, this.options)
    const shown = new Set<string>()

    // Ask for what is missing, nearest first: the ground under the camera
    // is what somebody is looking at.
    const missing = leaves
      .filter((leaf) => this.entries.get(keyOf(leaf))?.requested !== true)
      .map((leaf) => ({ leaf, distance: gap(centreOf(leaf), camera) }))
      .sort((a, b) => a.distance - b.distance)
    for (const { leaf } of missing) {
      if (this.waiting >= this.options.inFlight) break
      this.request(leaf)
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
    ground.setIndex(new THREE.BufferAttribute(this.index, 1))
    ground.computeBoundingSphere()
    node.add(new THREE.Mesh(ground, this.materials.ground))

    if (patch.hasSea) {
      // The sea over this patch: the same grid laid on the smooth sphere at
      // sea level, so it shares the index and meets its neighbours' water.
      const count = patch.positions.length / 3
      const positions = new Float32Array(count * 3)
      const normals = new Float32Array(count * 3)
      for (let vertex = 0; vertex < count; vertex += 1) {
        const x = patch.positions[vertex * 3] ?? 0
        const y = patch.positions[vertex * 3 + 1] ?? 0
        const z = patch.positions[vertex * 3 + 2] ?? 1
        const length = Math.hypot(x, y, z) || 1
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
      water.setIndex(new THREE.BufferAttribute(this.index, 1))
      water.computeBoundingSphere()
      const sea = new THREE.Mesh(water, this.materials.water)
      sea.renderOrder = 1
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

const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Geometry only: the materials and the index are shared and outlive a patch. */
function free(node: THREE.Group): void {
  node.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry: unknown = child.geometry
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
    }
  })
}
