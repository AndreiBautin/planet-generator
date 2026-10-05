import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import type { Builder } from '../builder'
import { keyOf, type PatchKey, type Vec3 } from './cube'
import { featuresFor } from './feature-models'
import { centreOf, featureTiles, type ViewCone } from './lod'
import { SCATTER_LEVEL } from './scatter'

/**
 * The features standing near the camera — trees, rocks, spires, floes —
 * streamed in tiles of their own, apart from the ground.
 *
 * Apart because the ground's patches only reach their finest a flight's
 * height or two from the camera, and a forest that existed only directly
 * underneath would be no forest at all. Feature tiles are one fixed size and
 * asked for out to a range in view, whatever the ground there is drawn at;
 * past the range, the ground shader's own patterns carry the look.
 */
export interface FloraOptions {
  /** How far from the camera features stand, in planet radii. */
  readonly range: number
  /** Tile requests out at once. */
  readonly inFlight: number
  /** Tiles kept after they leave the range, for flying back over them. */
  readonly cached: number
}

interface Tile {
  readonly key: PatchKey
  node: THREE.Group | undefined
  usedAt: number
}

export class Flora {
  readonly group = new THREE.Group()
  private readonly tiles = new Map<string, Tile>()
  private readonly world: Planet
  private readonly builder: Builder
  private readonly options: FloraOptions
  private readonly material: THREE.Material
  private waiting = 0
  private frame = 0
  private disposed = false

  constructor(world: Planet, builder: Builder, options: FloraOptions, material: THREE.Material) {
    this.world = world
    this.builder = builder
    this.options = options
    this.material = material
  }

  update(camera: Vec3, view?: ViewCone): void {
    if (this.disposed) return
    this.frame += 1
    const wanted = featureTiles(camera, SCATTER_LEVEL, this.options.range, view)
    const shown = new Set(wanted.map(keyOf))

    // Nearest first, a few at a time.
    const missing = wanted
      .filter((key) => !this.tiles.has(keyOf(key)))
      .map((key) => {
        const c = centreOf(key)
        return { key, distance: Math.hypot(c[0] - camera[0], c[1] - camera[1], c[2] - camera[2]) }
      })
      .sort((a, b) => a.distance - b.distance)
    for (const { key } of missing) {
      if (this.waiting >= this.options.inFlight) break
      this.request(key)
    }

    for (const [name, tile] of this.tiles) {
      if (tile.node === undefined) continue
      const visible = shown.has(name)
      tile.node.visible = visible
      if (visible) tile.usedAt = this.frame
    }
    this.evict(shown)
  }

  dispose(): void {
    this.disposed = true
    for (const tile of this.tiles.values()) if (tile.node !== undefined) free(tile.node)
    this.tiles.clear()
    this.material.dispose()
  }

  private request(key: PatchKey): void {
    const name = keyOf(key)
    const tile: Tile = { key, node: undefined, usedAt: this.frame }
    this.tiles.set(name, tile)
    this.waiting += 1
    void this.builder.features(this.world.seed, this.world.dials, key).then((scatter) => {
      this.waiting -= 1
      if (this.disposed || this.tiles.get(name) !== tile) return
      const node = new THREE.Group()
      for (const mesh of featuresFor(scatter, this.material)) node.add(mesh)
      node.visible = false
      tile.node = node
      this.group.add(node)
    })
  }

  private evict(shown: ReadonlySet<string>): void {
    const held = [...this.tiles.values()].filter((tile) => tile.node !== undefined)
    if (held.length <= this.options.cached) return
    const spare = held
      .filter((tile) => !shown.has(keyOf(tile.key)))
      .sort((a, b) => a.usedAt - b.usedAt)
    for (const tile of spare.slice(0, held.length - this.options.cached)) {
      if (tile.node !== undefined) {
        this.group.remove(tile.node)
        free(tile.node)
      }
      this.tiles.delete(keyOf(tile.key))
    }
  }
}

/** Instances only: the models are shared by every tile. */
function free(node: THREE.Group): void {
  node.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) child.dispose()
  })
}
