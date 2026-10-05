import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import type { Builder } from '../builder'
import { DETAIL_TIME } from '../detail'
import type { GroundLayer } from '../textures'
import { keyOf, patchAngle, type PatchKey, type Vec3 } from './cube'
import { featureMaterial, featuresFor } from './feature-models'
import { aheadOf, centreOf, featureTiles, insideHole, type Hole, type ViewCone } from './lod'
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
 *
 * Tiles are asked for some way beyond the range they are shown at, the
 * ones ahead of the camera first, so that by the time the flight reaches
 * ground its features are usually already in — and a tile that does arrive
 * late grows up out of the ground rather than appearing.
 */
export interface FloraOptions {
  /** How far from the camera features stand, in planet radii. */
  readonly range: number
  /** Tile requests out at once. */
  readonly inFlight: number
  /** Tiles kept after they leave the range, for flying back over them. */
  readonly cached: number
  /** The ground's stone photograph, which rock and columns wear. */
  readonly stone: GroundLayer
}

interface Tile {
  readonly key: PatchKey
  node: THREE.Group | undefined
  material: THREE.Material | undefined
  usedAt: number
}

/** How far beyond the shown range tiles are fetched, as a share of it. */
const PREFETCH = 1.4

export class Flora {
  readonly group = new THREE.Group()
  private readonly tiles = new Map<string, Tile>()
  private readonly world: Planet
  private readonly builder: Builder
  private readonly options: FloraOptions
  private waiting = 0
  private frame = 0
  private disposed = false
  private felled: readonly string[] = []

  constructor(world: Planet, builder: Builder, options: FloraOptions) {
    this.world = world
    this.builder = builder
    this.options = options
  }

  update(camera: Vec3, view?: ViewCone, hole?: Hole): void {
    if (this.disposed) return
    this.frame += 1
    const wanted = featureTiles(camera, SCATTER_LEVEL, this.options.range * PREFETCH, view).filter(
      (key) => hole === undefined || !insideHole(key, hole),
    )
    const reach = patchAngle(SCATTER_LEVEL) * 0.75
    const shown = new Set(
      wanted
        .filter((key) => {
          const c = centreOf(key)
          return (
            Math.hypot(c[0] - camera[0], c[1] - camera[1], c[2] - camera[2]) - reach <=
            this.options.range
          )
        })
        .map(keyOf),
    )

    // Nearest first, and ahead before beside, a few at a time.
    const missing = wanted
      .filter((key) => !this.tiles.has(keyOf(key)))
      .map((key) => ({ key, distance: aheadOf(centreOf(key), camera, view) }))
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
    for (const tile of this.tiles.values()) free(tile)
    this.tiles.clear()
  }

  /** The placements felled on this world: every tile is built again without them. */
  setFelled(ids: readonly string[]): void {
    if (ids === this.felled) return
    this.felled = ids
    for (const tile of this.tiles.values()) {
      if (tile.node !== undefined) this.group.remove(tile.node)
      free(tile)
    }
    this.tiles.clear()
  }

  private request(key: PatchKey): void {
    const name = keyOf(key)
    const tile: Tile = { key, node: undefined, material: undefined, usedAt: this.frame }
    this.tiles.set(name, tile)
    this.waiting += 1
    void this.builder
      .features(this.world.seed, this.world.dials, key, this.felled)
      .then((scatter) => {
        this.waiting -= 1
        if (this.disposed || this.tiles.get(name) !== tile) return
        const node = new THREE.Group()
        const material = featureMaterial(DETAIL_TIME.value, this.options.stone)
        for (const mesh of featuresFor(scatter, material)) node.add(mesh)
        node.visible = false
        tile.node = node
        tile.material = material
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
      if (tile.node !== undefined) this.group.remove(tile.node)
      free(tile)
      this.tiles.delete(keyOf(tile.key))
    }
  }
}

/** Instances and the tile's material only: the models are shared by every tile. */
function free(tile: Tile): void {
  tile.node?.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) child.dispose()
  })
  tile.material?.dispose()
}
