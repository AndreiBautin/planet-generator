import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import type { Builder } from '../builder'
import { SEA_RADIUS } from '../water'
import {
  childrenOf,
  keyOf,
  neighboursOf,
  parentOf,
  patchAngle,
  ROOTS,
  type PatchKey,
  type Vec3,
} from './cube'
import { aheadOf, ancestorAt, centreOf, selectLeaves, type LodParams, type ViewCone } from './lod'
import { forestFor, TREE_COARSEST, TREE_LEVEL, treeDepthMaterial, treeMaterial } from './forest'
import { patchIndex, quarterIndex, type PatchData } from './patch-data'
import { DETAIL_TIME, TERRAIN_MORPH } from '../detail'

/**
 * A planet's ground, streamed: asks the builder for the patches the camera
 * needs, draws each as it arrives, and until then draws the finest ancestor
 * it already has. The six whole faces are fetched first and never let go,
 * so there is always a planet to draw, however coarse.
 */
export interface TerrainOptions extends LodParams {
  /** The woods' two colours (forest.ts); absent for a world with none. */
  readonly trees: { readonly conifer: THREE.Color; readonly broadleaf: THREE.Color } | undefined
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
  /** Which edges are stitched to a coarser neighbour, a bit each, and the attribute that says so. */
  edges: number[]
  stitch: THREE.BufferAttribute | undefined
  /** Its four neighbours at its own level (`neighboursOf`), found once. */
  neighbours?: readonly PatchKey[]
  /** Its trees (forest.ts), shown by what ground is drawn rather than with its own node. */
  trees: THREE.Mesh[]
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
  private lastCamera: Vec3 | undefined
  /** How much looser than asked the detail threshold is right now, 1 and up. */
  private coarsen = 1
  private lateness = 0
  private governedAt = 0
  private stitchedAt = 0

  private readonly world: Planet
  private readonly builder: Builder
  private readonly options: TerrainOptions
  private readonly materials: TerrainMaterials
  private readonly treeMaterial: THREE.Material
  private readonly treeDepth: THREE.Material
  private readonly forest = new THREE.Group()
  /** How far a coarser edge bends the vertices in from it, by rows from the edge (see `stitch`). */
  private readonly stitchFalloff: Float32Array

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
    // The woods, on the ground's own vertices (forest.ts).
    this.treeMaterial = treeMaterial()
    this.treeDepth = treeDepthMaterial()
    this.group.add(this.forest)
    // One array of triangles for every patch; each geometry wraps it in an
    // attribute of its own, because disposing a geometry frees its index's
    // GPU buffer and a shared attribute would be freed from under the rest.
    this.index = patchIndex(options.segments)
    const side = options.segments + 1
    const band = Math.max(2, (side - 1) / 4)
    this.stitchFalloff = Float32Array.from({ length: side }, (_, k) => {
      const t = Math.min(1, k / band)
      return 1 - t * t * (3 - 2 * t)
    })
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
    // The detail asked for is what the builders can keep up with. Fine
    // ground that lands after the eye has arrived is ground sharpening
    // under you as you fly; a picture a step coarser that is all there is
    // a picture. So the threshold loosens while patches run late, and
    // tightens again, slowly, once they keep up.
    const params = { ...this.options, threshold: this.options.threshold * this.coarsen }
    TERRAIN_MORPH.value.set(this.options.segments, params.threshold)
    const leaves = selectLeaves(camera, params, view)
    let behind = 0
    for (const leaf of leaves) {
      for (let k: PatchKey | undefined = leaf; k !== undefined; k = parentOf(k)) {
        if (this.entries.get(keyOf(k))?.node !== undefined) break
        behind += 1
      }
    }
    this.govern(behind / Math.max(1, leaves.length))

    // Refine from coarse to fine: where a leaf is drawn by a stand-in, ask
    // for the next level down from the stand-in rather than for the leaf
    // itself. Diving from orbit, the leaves are seven levels below what is
    // on screen; asking for them directly left the coarse faces up until the
    // finest ground arrived all at once, and a step at a time sharpens the
    // view on the way down. Nearest first: the ground under the camera is
    // what somebody is looking at.
    const wanted = new Map<string, { readonly key: PatchKey; readonly distance: number }>()
    const ask = (leaf: PatchKey, later: number): void => {
      let drawn = -1
      for (let level = leaf.level; level >= 0; level -= 1) {
        if (this.entries.get(keyOf(ancestorAt(leaf, level)))?.node !== undefined) {
          drawn = level
          break
        }
      }
      if (drawn === leaf.level) return
      const next = ancestorAt(leaf, drawn + 1)
      const name = keyOf(next)
      if (this.entries.get(name)?.requested === true || wanted.has(name)) return
      wanted.set(name, { key: next, distance: later + aheadOf(centreOf(next), camera, view) })
    }
    for (const leaf of leaves) ask(leaf, 0)
    // And the ground a second and a half on, at the pace the eye is moving,
    // asked for after everything needed now: on a phone the builder runs
    // behind a glide, and ground asked for only once it was needed arrived
    // after the eye did, sharpening in front of it.
    const last = this.lastCamera
    this.lastCamera = camera
    if (last !== undefined) {
      const ahead: Vec3 = [
        camera[0] + (camera[0] - last[0]) * PREFETCH_FRAMES,
        camera[1] + (camera[1] - last[1]) * PREFETCH_FRAMES,
        camera[2] + (camera[2] - last[2]) * PREFETCH_FRAMES,
      ]
      const moved = Math.hypot(ahead[0] - camera[0], ahead[1] - camera[1], ahead[2] - camera[2])
      if (moved > 1e-4 && moved < 0.2) {
        for (const leaf of selectLeaves(ahead, params, view)) ask(leaf, 100)
      }
    }
    const queue = [...wanted.values()].sort((a, b) => a.distance - b.distance)
    for (const { key, distance } of queue) {
      if (this.waiting >= this.options.inFlight) break
      this.request(key, distance)
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
    // For the recorder: how many of the leaves wanted are drawn coarser than
    // asked, and how near the nearest is, so lateness is measured, not guessed.
    let standIns = 0
    let nearest = Number.POSITIVE_INFINITY
    for (const leaf of leaves) {
      if (this.entries.get(keyOf(leaf))?.node !== undefined) continue
      standIns += 1
      const c = centreOf(leaf)
      const gap =
        Math.hypot(camera[0] - c[0], camera[1] - c[1], camera[2] - c[2]) -
        patchAngle(leaf.level) * 0.75
      nearest = Math.min(nearest, Math.max(0, gap))
    }
    TERRAIN_STATS.standIns = standIns
    TERRAIN_STATS.nearestStandIn = nearest
    TERRAIN_STATS.pending = this.waiting
    TERRAIN_STATS.coarsen = this.coarsen
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
    this.stitch(drawn)
    // The trees: each drawn patch's own between the coarsest level that
    // carries them and `TREE_LEVEL`, and for finer ground its ancestor's at
    // `TREE_LEVEL`, whose vertices are among its own.
    const wooded = new Set<string>()
    for (const name of drawn.keys()) {
      const key = this.entries.get(name)?.key
      if (key === undefined || key.level < TREE_COARSEST) continue
      wooded.add(keyOf(key.level > TREE_LEVEL ? ancestorAt(key, TREE_LEVEL) : key))
    }
    for (const [name, entry] of this.entries) {
      const on = wooded.has(name)
      for (const mesh of entry.trees) mesh.visible = on
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
    this.evict(new Set([...shown, ...wooded]))
  }

  /**
   * Where a drawn patch meets a coarser one, bend its edge to the coarser
   * edge: the stitch attribute slides those vertices to where the parent
   * draws them, which is where the coarser neighbour's edge lies. Without
   * it the two edges only nearly met, and the skirt hung under the finer one
   * showed as a pale curtain wherever the ground stepped down — sharpest
   * along a snowline.
   */
  private stitch(drawn: ReadonlyMap<string, number>): void {
    const coarser = (key: PatchKey): boolean => {
      if (drawn.has(keyOf(key))) return false
      let below = key
      for (let above = parentOf(key); above !== undefined; above = parentOf(above)) {
        const quarters = drawn.get(keyOf(above))
        if (quarters !== undefined) {
          const quarter = below.x - above.x * 2 + (below.y - above.y * 2) * 2
          return (quarters & (1 << quarter)) !== 0
        }
        below = above
      }
      return false
    }
    // Eased, at the pace a patch slides in: a neighbour arriving finer
    // slides from the coarse shape over the same time, so the two edges
    // move together. Snapped, the edge jumped in one frame along a line.
    const now = DETAIL_TIME.value
    const step = Math.max(0, Math.min(1, (now - this.stitchedAt) / ARRIVAL_SECONDS))
    this.stitchedAt = now
    for (const name of drawn.keys()) {
      const entry = this.entries.get(name)
      if (entry?.stitch === undefined) continue
      // A patch's neighbours never change; found once, not every frame.
      entry.neighbours ??= neighboursOf(entry.key)
      const goals = entry.neighbours.map((neighbour) => (coarser(neighbour) ? 1 : 0))
      const fresh = !this.lastShown.has(name)
      const edges = entry.edges.map((weight, edge) => {
        const goal = goals[edge] ?? 0
        // A patch first drawn takes its edges as they are, with nothing to ease from.
        const next = fresh ? goal : weight + Math.max(-step, Math.min(step, goal - weight))
        return next
      })
      if (edges.every((weight, edge) => weight === entry.edges[edge])) continue
      entry.edges = edges
      const values = entry.stitch.array as Float32Array
      const side = this.options.segments + 1
      const grid = side * side
      // Not the edge row alone but a band in from it, easing from the
      // coarse shape at the edge to the patch's own a quarter of the way in.
      // Bent at the edge only, the two levels met at a straight line, and
      // where they disagree most — a flat coast, land in one and shallows in
      // the other — that line drew a square of land standing in the sea.
      // The falloff by distance from an edge is worked out once
      // (`stitchFalloff`); this runs every frame an edge eases, and built
      // per vertex it was a third of the frame's script on a phone profile.
      const fall = this.stitchFalloff
      const [bottom = 0, top = 0, left = 0, right = 0] = edges
      for (let j = 0; j < side; j += 1) {
        const fromBottom = bottom * (fall[j] ?? 0)
        const fromTop = top * (fall[side - 1 - j] ?? 0)
        const rows = Math.max(fromBottom, fromTop)
        for (let i = 0; i < side; i += 1) {
          values[j * side + i] = Math.max(
            rows,
            left * (fall[i] ?? 0),
            right * (fall[side - 1 - i] ?? 0),
          )
        }
      }
      for (let k = 0; k < side; k += 1) {
        for (let edge = 0; edge < 4; edge += 1) values[grid + edge * side + k] = edges[edge] ?? 0
      }
      entry.stitch.needsUpdate = true
    }
  }

  /**
   * Loosen the detail while the patches on screen run behind, and tighten
   * it again once they keep up. `behind` is the average number of levels
   * the drawn ground is short of what was asked for, this frame.
   */
  private govern(behind: number): void {
    // Smoothed, so a single late patch does not move it.
    this.lateness += (behind - this.lateness) * 0.1
    const now = DETAIL_TIME.value
    if (now - this.governedAt < GOVERN_EVERY) return
    this.governedAt = now
    if (this.lateness > LATE) this.coarsen = Math.min(COARSEST, this.coarsen * 1.25)
    else if (this.lateness < CAUGHT_UP && this.coarsen > 1) {
      this.coarsen = Math.max(1, this.coarsen / 1.1)
    }
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
    for (const entry of this.entries.values()) {
      if (entry.node !== undefined) free(entry.node)
      for (const mesh of entry.trees) mesh.geometry.dispose()
    }
    this.entries.clear()
    this.materials.ground.dispose()
    this.materials.groundDepth.dispose()
    this.materials.water.dispose()
    this.treeMaterial.dispose()
    this.treeDepth.dispose()
  }

  private request(key: PatchKey, urgency = 0): void {
    const name = keyOf(key)
    const existing = this.entries.get(name)
    if (existing?.requested === true) return
    const entry: Entry = existing ?? {
      key,
      node: undefined,
      arrival: [],
      whole: [],
      quarters: [[], [], [], []],
      edges: [0, 0, 0, 0],
      stitch: undefined,
      trees: [],
      shownAt: undefined,
      requested: true,
      usedAt: this.frame,
    }
    entry.requested = true
    this.entries.set(name, entry)
    this.waiting += 1
    void this.builder
      .patch(this.world.seed, this.world.dials, key, this.options.segments, urgency)
      .then((patch) => {
        this.waiting -= 1
        // A planet replaced while its patches were being made: drop them.
        if (this.disposed || this.entries.get(name) !== entry) return
        entry.node = this.nodeFor(patch, entry.arrival, entry.whole, entry.quarters)
        if (this.options.trees !== undefined) {
          entry.trees = forestFor(
            patch,
            key.level,
            this.options.segments,
            this.treeMaterial,
            this.treeDepth,
            this.options.trees,
          )
          for (const mesh of entry.trees) {
            mesh.visible = false
            this.forest.add(mesh)
          }
        }
        entry.stitch = entry.node.userData.stitch as THREE.BufferAttribute
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
    ground.setAttribute('mistTop', new THREE.BufferAttribute(patch.mist, 1))
    ground.setAttribute('reef', new THREE.BufferAttribute(patch.reef, 1))
    ground.setAttribute('coarsePosition', new THREE.BufferAttribute(patch.coarsePositions, 4))
    ground.setAttribute('coarseNormal', new THREE.BufferAttribute(patch.coarseNormals, 3))
    ground.setAttribute('coarseColour', new THREE.BufferAttribute(patch.coarseColours, 3))
    ground.setAttribute('coarsePattern', new THREE.BufferAttribute(patch.coarsePattern, 4))
    // Eight floats a vertex: its own four biome grounds, then its parent's.
    const kinds = new THREE.InterleavedBuffer(patch.ground, 8)
    ground.setAttribute('ground', new THREE.InterleavedBufferAttribute(kinds, 4, 0))
    ground.setAttribute('coarseGround', new THREE.InterleavedBufferAttribute(kinds, 4, 4))
    ground.setIndex(new THREE.BufferAttribute(this.index, 1))
    ground.computeBoundingSphere()
    const landArrival = new THREE.BufferAttribute(new Float32Array(patch.positions.length / 3), 1)
    landArrival.setUsage(THREE.DynamicDrawUsage)
    ground.setAttribute('arrival', landArrival)
    arrival.push(landArrival)
    const stitch = new THREE.BufferAttribute(new Float32Array(patch.positions.length / 3), 1)
    stitch.setUsage(THREE.DynamicDrawUsage)
    ground.setAttribute('stitch', stitch)
    node.userData.stitch = stitch
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
      // Whether the water here is a lake or a river rather than the sea: no
      // swell and no surf on it, and its shallows read by its own depth.
      const inland = new Float32Array(count)
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
        // The water's own surface here: the sea, a lake, or a river, and past
        // their shores a sheet held under the dry ground (patch-data.ts).
        const level = patch.water[vertex] ?? 0
        const surface = level > 0 ? level : SEA_RADIUS
        inland[vertex] = level > SEA_RADIUS + 1e-6 ? 1 : 0
        const coarse =
          surface -
          Math.hypot(
            patch.coarsePositions[vertex * 4] ?? 0,
            patch.coarsePositions[vertex * 4 + 1] ?? 0,
            patch.coarsePositions[vertex * 4 + 2] ?? 0,
          )
        if (vertex < grid) {
          depth[vertex] = surface - length
          coarseDepth[vertex] = coarse
          edgeDepth.set(keyOf(x, y, z), depth[vertex] ?? 0)
          edgeCoarse.set(keyOf(x, y, z), coarse)
        } else {
          depth[vertex] = edgeDepth.get(keyOf(x, y, z)) ?? surface - length
          coarseDepth[vertex] = edgeCoarse.get(keyOf(x, y, z)) ?? coarse
        }
        normals[vertex * 3] = x / length
        normals[vertex * 3 + 1] = y / length
        normals[vertex * 3 + 2] = z / length
        positions[vertex * 3] = (x / length) * surface
        positions[vertex * 3 + 1] = (y / length) * surface
        positions[vertex * 3 + 2] = (z / length) * surface
      }
      const water = new THREE.BufferGeometry()
      water.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      water.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      water.setAttribute('depth', new THREE.BufferAttribute(depth, 1))
      water.setAttribute('coarseDepth', new THREE.BufferAttribute(coarseDepth, 1))
      water.setAttribute('inland', new THREE.BufferAttribute(inland, 1))
      water.setAttribute('ice', new THREE.BufferAttribute(patch.ice, 2))
      water.setAttribute('mistTop', new THREE.BufferAttribute(patch.mist, 1))
      water.setAttribute('rapids', new THREE.BufferAttribute(patch.rapids, 1))
      water.setAttribute('current', new THREE.BufferAttribute(patch.current, 3))
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
      for (const mesh of entry.trees) {
        this.forest.remove(mesh)
        mesh.geometry.dispose()
      }
      this.entries.delete(keyOf(entry.key))
      this.sliding.delete(entry)
    }
  }
}

/** What the last frame's selection looked like, for the development recorder to read. */
export const TERRAIN_STATS = {
  standIns: 0,
  nearestStandIn: Number.POSITIVE_INFINITY,
  pending: 0,
  coarsen: 1,
}

/** How far ahead the ground is asked for, in frames at the eye's present pace (about 1.5 s at 30 fps). */
const PREFETCH_FRAMES = 45

/** How often the governor may move, in seconds, and the lateness it moves at. */
const GOVERN_EVERY = 0.5
const LATE = 0.5
const CAUGHT_UP = 0.15
/** The loosest the threshold goes: three steps coarser, about one and a half levels. */
export const COARSEST = 3

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
      // Its own geometry, over the shared model's attributes (feature-models.ts).
      const geometry: unknown = child.geometry
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
      return
    }
    if (child instanceof THREE.Mesh) {
      const geometry: unknown = child.geometry
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
    }
  })
}
