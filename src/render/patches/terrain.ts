import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import type { Builder } from '../builder'
import { SEA_RADIUS } from '../water'
import { childrenOf, keyOf, parentOf, ROOTS, type PatchKey, type Vec3 } from './cube'
import { aheadOf, ancestorAt, centreOf, selectLeaves, type LodParams, type ViewCone } from './lod'
import { Flora, type FloraOptions } from './flora'
import { patchIndex, quarterIndex, type PatchData } from './patch-data'
import { DETAIL_TIME } from '../detail'

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
  /** The ground's shadow caster, blended between levels as the ground is. */
  readonly groundDepth: THREE.Material
  readonly water: THREE.Material
}

interface Entry {
  readonly key: PatchKey
  node: THREE.Group | undefined
  /** The arrival weights of its ground and its sea, written while it slides in. */
  readonly arrival: THREE.BufferAttribute[]
  /** Its ground and sea drawn whole, and a quarter at a time (in `childrenOf` order). */
  readonly whole: THREE.Object3D[]
  readonly quarters: THREE.Object3D[][]
  shownAt: number | undefined
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
  private lastShown: ReadonlySet<string> = new Set<string>()
  private readonly sliding = new Set<Entry>()

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

    // What to draw: the leaves where they are in, and where one is not, the
    // nearest patch above it that is — but only the quarter of that patch
    // over the gap. Drawing a stand-in whole hid every finer patch under it
    // that was already in, so one patch still on its way turned whole faces
    // of the planet coarse for a moment: the ground changing as you flew.
    const internal = new Set<string>()
    for (const leaf of leaves) {
      for (let above = parentOf(leaf); above !== undefined; above = parentOf(above)) {
        const name = keyOf(above)
        if (internal.has(name)) break
        internal.add(name)
      }
    }
    const loaded = (key: PatchKey): boolean => this.entries.get(keyOf(key))?.node !== undefined
    const cover = (key: PatchKey, out: Map<string, number>): boolean => {
      const name = keyOf(key)
      if (!internal.has(name)) {
        if (loaded(key)) {
          out.set(name, WHOLE)
          return true
        }
        // Flying away from ground last seen closer: its children, if all in.
        const children = childrenOf(key)
        if (key.level < this.options.maxLevel && children.every(loaded)) {
          for (const child of children) out.set(keyOf(child), WHOLE)
          return true
        }
        return false
      }
      const found = new Map<string, number>()
      let gaps = 0
      childrenOf(key).forEach((child, quarter) => {
        if (!cover(child, found)) gaps |= 1 << quarter
      })
      if (gaps !== 0) {
        if (!loaded(key)) return false
        out.set(name, gaps)
      }
      for (const [inside, quarters] of found) out.set(inside, quarters)
      return true
    }
    const drawn = new Map<string, number>()
    for (const root of ROOTS) cover(root, drawn)
    const shown = new Set(drawn.keys())
    // What is drawn, and everything above it, stays held: a patch's parents
    // are its stand-ins, and evicting them as idle left nothing to fall back
    // on but a whole face.
    for (const name of shown) {
      for (let key = this.entries.get(name)?.key; key !== undefined; key = parentOf(key)) {
        const entry = this.entries.get(keyOf(key))
        if (entry !== undefined) entry.usedAt = this.frame
      }
    }

    for (const [name, entry] of this.entries) {
      if (entry.node === undefined) continue
      const quarters = drawn.get(name) ?? 0
      const visible = quarters !== 0
      // Coming in finer than what stood here last frame: start as the
      // parent and slide (see the arrival attribute). Coming back coarser,
      // in place of children that had already slid to look like it, nothing
      // needs to move.
      if (visible && !entry.node.visible && this.drawnAbove(entry.key)) {
        entry.shownAt = DETAIL_TIME.value
        this.sliding.add(entry)
      }
      entry.node.visible = visible
      for (const part of entry.whole) part.visible = quarters === WHOLE
      entry.quarters.forEach((parts, quarter) => {
        const on = quarters !== WHOLE && (quarters & (1 << quarter)) !== 0
        for (const part of parts) part.visible = on
      })
    }
    this.lastShown = shown
    for (const entry of this.sliding) {
      const weight = entry.shownAt === undefined ? 0 : arrivalAt(entry.shownAt, DETAIL_TIME.value)
      for (const attribute of entry.arrival) {
        ;(attribute.array as Float32Array).fill(weight)
        attribute.needsUpdate = true
      }
      if (weight <= 0) this.sliding.delete(entry)
    }
    this.evict(shown)
  }

  /** Whether a coarser patch over this one was drawn last frame. */
  private drawnAbove(key: PatchKey): boolean {
    for (let above = parentOf(key); above !== undefined; above = parentOf(above)) {
      if (this.lastShown.has(keyOf(above))) return true
    }
    return false
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) if (entry.node !== undefined) free(entry.node)
    this.entries.clear()
    this.materials.ground.dispose()
    this.materials.groundDepth.dispose()
    this.materials.water.dispose()
    this.flora.dispose()
  }

  private request(key: PatchKey): void {
    const name = keyOf(key)
    const existing = this.entries.get(name)
    if (existing?.requested === true) return
    const entry: Entry = existing ?? {
      key,
      node: undefined,
      arrival: [],
      whole: [],
      quarters: [[], [], [], []],
      shownAt: undefined,
      requested: true,
      usedAt: this.frame,
    }
    entry.requested = true
    this.entries.set(name, entry)
    this.waiting += 1
    void this.builder
      .patch(this.world.seed, this.world.dials, key, this.options.segments)
      .then((patch) => {
        this.waiting -= 1
        // A planet replaced while its patches were being made: drop them.
        if (this.disposed || this.entries.get(name) !== entry) return
        entry.node = this.nodeFor(patch, entry.arrival, entry.whole, entry.quarters)
        entry.node.visible = false
        this.group.add(entry.node)
      })
  }

  private nodeFor(
    patch: PatchData,
    arrival: THREE.BufferAttribute[],
    whole: THREE.Object3D[],
    quarters: THREE.Object3D[][],
  ): THREE.Group {
    const node = new THREE.Group()
    const ground = new THREE.BufferGeometry()
    ground.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3))
    ground.setAttribute('normal', new THREE.BufferAttribute(patch.normals, 3))
    ground.setAttribute('color', new THREE.BufferAttribute(patch.colours, 3))
    ground.setAttribute('pattern', new THREE.BufferAttribute(patch.pattern, 4))
    ground.setAttribute('coarsePosition', new THREE.BufferAttribute(patch.coarsePositions, 4))
    ground.setAttribute('coarseNormal', new THREE.BufferAttribute(patch.coarseNormals, 3))
    ground.setAttribute('coarseColour', new THREE.BufferAttribute(patch.coarseColours, 3))
    ground.setAttribute('coarsePattern', new THREE.BufferAttribute(patch.coarsePattern, 4))
    ground.setIndex(new THREE.BufferAttribute(this.index, 1))
    ground.computeBoundingSphere()
    const landArrival = new THREE.BufferAttribute(new Float32Array(patch.positions.length / 3), 1)
    landArrival.setUsage(THREE.DynamicDrawUsage)
    ground.setAttribute('arrival', landArrival)
    arrival.push(landArrival)
    const landOf = (geometry: THREE.BufferGeometry): THREE.Mesh => {
      const land = new THREE.Mesh(geometry, this.materials.ground)
      land.receiveShadow = true
      land.castShadow = true
      land.customDepthMaterial = this.materials.groundDepth
      node.add(land)
      return land
    }
    whole.push(landOf(ground))
    quarterGeometries(ground, this.options.segments).forEach((geometry, quarter) => {
      quarters[quarter]?.push(landOf(geometry))
    })

    if (patch.hasSea) {
      // The sea over this patch: the same grid laid on the smooth sphere at
      // sea level, so it shares the index and meets its neighbours' water.
      const count = patch.positions.length / 3
      const positions = new Float32Array(count * 3)
      const normals = new Float32Array(count * 3)
      // How deep the floor lies under the sea here: foam where it is nought,
      // lighter water where it is little.
      const depth = new Float32Array(count)
      // And how deep the parent patch would say it is, to slide towards.
      const coarseDepth = new Float32Array(count)
      const edgeCoarse = new Map<string, number>()
      // The skirt's vertices sit under the edge's, lowered: read as their own
      // depth they made every patch boundary a line of deeper, darker water.
      // A skirt vertex shares its edge vertex's direction, so it takes that
      // vertex's depth.
      const side = Math.round(-2 + Math.sqrt(4 + count))
      const grid = side * side
      const edgeDepth = new Map<string, number>()
      const keyOf = (x: number, y: number, z: number): string => {
        const l = Math.hypot(x, y, z) || 1
        return `${(x / l).toFixed(6)},${(y / l).toFixed(6)},${(z / l).toFixed(6)}`
      }
      for (let vertex = 0; vertex < count; vertex += 1) {
        const x = patch.positions[vertex * 3] ?? 0
        const y = patch.positions[vertex * 3 + 1] ?? 0
        const z = patch.positions[vertex * 3 + 2] ?? 1
        const length = Math.hypot(x, y, z) || 1
        const coarse =
          SEA_RADIUS -
          Math.hypot(
            patch.coarsePositions[vertex * 4] ?? 0,
            patch.coarsePositions[vertex * 4 + 1] ?? 0,
            patch.coarsePositions[vertex * 4 + 2] ?? 0,
          )
        if (vertex < grid) {
          depth[vertex] = SEA_RADIUS - length
          coarseDepth[vertex] = coarse
          edgeDepth.set(keyOf(x, y, z), depth[vertex] ?? 0)
          edgeCoarse.set(keyOf(x, y, z), coarse)
        } else {
          depth[vertex] = edgeDepth.get(keyOf(x, y, z)) ?? SEA_RADIUS - length
          coarseDepth[vertex] = edgeCoarse.get(keyOf(x, y, z)) ?? coarse
        }
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
      water.setAttribute('coarseDepth', new THREE.BufferAttribute(coarseDepth, 1))
      water.setAttribute('coarsePosition', new THREE.BufferAttribute(patch.coarsePositions, 4))
      water.setIndex(new THREE.BufferAttribute(this.index, 1))
      water.computeBoundingSphere()
      const seaArrival = new THREE.BufferAttribute(new Float32Array(count), 1)
      seaArrival.setUsage(THREE.DynamicDrawUsage)
      water.setAttribute('arrival', seaArrival)
      arrival.push(seaArrival)
      const seaOf = (geometry: THREE.BufferGeometry): THREE.Mesh => {
        const sea = new THREE.Mesh(geometry, this.materials.water)
        sea.renderOrder = 1
        sea.receiveShadow = true
        node.add(sea)
        return sea
      }
      whole.push(seaOf(water))
      quarterGeometries(water, this.options.segments).forEach((geometry, quarter) => {
        quarters[quarter]?.push(seaOf(geometry))
      })
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
      this.sliding.delete(entry)
    }
  }
}

/** Every quarter of a patch drawn: the patch whole. */
const WHOLE = 0b1111

/**
 * A patch's geometry a quarter at a time, sharing its vertices: the same
 * buffers under four smaller sets of triangles.
 */
function quarterGeometries(whole: THREE.BufferGeometry, segments: number): THREE.BufferGeometry[] {
  return [0, 1, 2, 3].map((quarter) => {
    const part = new THREE.BufferGeometry()
    for (const [name, attribute] of Object.entries(whole.attributes)) {
      part.setAttribute(name, attribute)
    }
    part.setIndex(new THREE.BufferAttribute(quarterIndex(segments, quarter), 1))
    part.boundingSphere = whole.boundingSphere?.clone() ?? null
    return part
  })
}

/** How long a finer patch takes to slide from its parent's shape to its own, in seconds. */
const ARRIVAL_SECONDS = 0.6

/** The arrival weight a patch shown at `at` carries at `now`: 1 as it appears, easing to 0. */
export function arrivalAt(at: number, now: number): number {
  const k = Math.min(1, Math.max(0, (now - at) / ARRIVAL_SECONDS))
  return 1 - k * k * (3 - 2 * k)
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
