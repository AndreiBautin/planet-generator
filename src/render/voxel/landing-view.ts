import * as THREE from 'three'

import {
  at,
  blockId,
  blockOf,
  CHUNK,
  FLUID,
  meshChunk,
  SOLID,
  type ChunkMesh,
  type Palette,
} from '@/generation/chunk'
import type { Vec3 } from '@/generation/cube'
import type { Planet } from '@/generation/planet'
import { AREA, BASE_ROW, BLOCK, blockKey, columnKey, HEIGHT, type Block } from '@/generation/voxel'

import { fromPalette } from '../colour'

import type { Builder } from '../builder'
import type { GroundTextures } from '../textures'
import { chunkMaterial, fluidMaterial } from './chunk-material'

/**
 * A landing on screen: the chunks around the surveyor, streamed in from
 * the builder as they come into reach and let go as they fall out of it,
 * placed in the planet's frame at the landing point.
 *
 * The chunks are built in the landing's own flat frame — x east, y up, z
 * north, a block a unit — and the whole group is set on the planet by one
 * matrix: moved to the landing point at sea level, turned so its y is the
 * local up, and scaled by `BLOCK`. A child of the terrain group, so it
 * turns with the planet as the trees do.
 *
 * It also answers what is at a block, from the chunks it holds, which is
 * what the walker stands on and the digger digs.
 */
export interface LandingViewOptions {
  /** Chunks kept loaded around the surveyor, as a radius in chunks. */
  readonly reach: number
  readonly inFlight: number
}

interface Held {
  readonly cx: number
  readonly cz: number
  node: THREE.Group | undefined
  blocks: Uint8Array | undefined
  requested: boolean
  usedAt: number
}

const keyOf = (cx: number, cz: number): string => `${String(cx)}/${String(cz)}`

export class LandingView {
  readonly group = new THREE.Group()
  readonly origin: Vec3
  readonly east: Vec3
  readonly north: Vec3
  private readonly held = new Map<string, Held>()
  private readonly planet: Planet
  private readonly builder: Builder
  private readonly options: LandingViewOptions
  private readonly solid: THREE.Material
  private readonly fluid: THREE.Material
  private readonly edits: Map<number, Block>
  /** The feature rooted in each column, from the chunks: dig its root row and it is felled. */
  private readonly roots = new Map<number, { readonly row: number; readonly id: string }>()
  private readonly palette: Palette
  private waiting = 0
  private frame = 0
  private disposed = false

  constructor(
    planet: Planet,
    frame: { readonly origin: Vec3; readonly east: Vec3; readonly north: Vec3 },
    /** The radius of the ground at the landing point, which row BASE_ROW sits at. */
    base: number,
    builder: Builder,
    textures: GroundTextures,
    options: LandingViewOptions,
    edits: ReadonlyMap<number, Block>,
  ) {
    this.planet = planet
    this.edits = new Map(edits)
    const linear = (rgb: readonly [number, number, number]): readonly [number, number, number] => {
      const c = fromPalette(rgb)
      return [c.r, c.g, c.b]
    }
    this.palette = {
      lush: linear(planet.palette.lush),
      dry: linear(planet.palette.dry),
      highland: linear(planet.palette.highland),
      peak: linear(planet.palette.peak),
      ice: linear(planet.palette.ice),
      shallow: linear(planet.palette.shallow),
    }
    this.origin = frame.origin
    this.east = frame.east
    this.north = frame.north
    this.builder = builder
    this.options = options
    this.solid = chunkMaterial(textures)
    this.fluid = fluidMaterial(planet)
    // The landing frame on the planet: columns of the basis are east, up,
    // north; the origin is at sea level under the landing point, and the
    // area's middle block sits there.
    const [ox, oy, oz] = frame.origin
    const [ex, ey, ez] = frame.east
    const [nx, ny, nz] = frame.north
    const basis = new THREE.Matrix4().set(ex, ox, nx, 0, ey, oy, ny, 0, ez, oz, nz, 0, 0, 0, 0, 1)
    this.group.quaternion.setFromRotationMatrix(basis)
    this.group.scale.setScalar(BLOCK)
    const shift = new THREE.Vector3(-AREA / 2, -BASE_ROW, -AREA / 2).multiplyScalar(BLOCK)
    shift.applyQuaternion(this.group.quaternion)
    this.group.position.set(ox * base, oy * base, oz * base).add(shift)
  }

  /** The chunk coordinates of a block column. */
  static chunkOf(x: number, z: number): readonly [number, number] {
    return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)]
  }

  /** What is at a block, from the chunks held; air where nothing is loaded yet. */
  blockAt(x: number, y: number, z: number): Block {
    if (y < 0 || y >= HEIGHT) return 'air'
    const [cx, cz] = LandingView.chunkOf(x, z)
    const chunk = this.held.get(keyOf(cx, cz))
    if (chunk?.blocks === undefined) return 'air'
    return blockOf(chunk.blocks[at(x - cx * CHUNK, y, z - cz * CHUNK)] ?? 0)
  }

  stuffAt(x: number, y: number, z: number): 'air' | 'solid' | 'liquid' {
    const block = this.blockAt(x, y, z)
    if (SOLID.has(block)) return 'solid'
    if (FLUID.has(block)) return 'liquid'
    return 'air'
  }

  /** The placement whose root this block is, if it is one. */
  rootAt(x: number, y: number, z: number): string | undefined {
    const root = this.roots.get(columnKey(x, z))
    return root !== undefined && root.row === y ? root.id : undefined
  }

  /** Every block changed by hand, as [key, block] pairs, for saving. */
  changes(): readonly (readonly [number, Block])[] {
    return [...this.edits]
  }

  /**
   * Change one block: in the edits, in the chunk that holds it and in the
   * halos of any neighbours that share its edge, and re-mesh those on the
   * page — one chunk is a few milliseconds, and a dig should land on the
   * same frame as the tap.
   */
  setBlock(x: number, y: number, z: number, block: Block): void {
    if (y < 0 || y >= HEIGHT) return
    this.edits.set(blockKey(x, y, z), block)
    const touched = new Set<string>()
    const [cx, cz] = LandingView.chunkOf(x, z)
    // The chunk itself and, where the block lies on an edge, the neighbour
    // whose halo holds a copy of it.
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const ox = cx + dx
        const oz = cz + dz
        const lx = x - ox * CHUNK
        const lz = z - oz * CHUNK
        if (lx < -1 || lx > CHUNK || lz < -1 || lz > CHUNK) continue
        const chunk = this.held.get(keyOf(ox, oz))
        if (chunk?.blocks === undefined) continue
        chunk.blocks[at(lx, y, lz)] = blockId(block)
        touched.add(keyOf(ox, oz))
      }
    }
    for (const name of touched) {
      const chunk = this.held.get(name)
      if (chunk?.blocks === undefined) continue
      if (chunk.node !== undefined) {
        this.group.remove(chunk.node)
        free(chunk.node)
      }
      chunk.node = this.nodeFor(meshChunk(chunk.blocks, this.palette), chunk.cx, chunk.cz)
      this.group.add(chunk.node)
    }
  }

  /** Whether the chunk under a column is in, so the walker has ground to stand on. */
  ready(x: number, z: number): boolean {
    const [cx, cz] = LandingView.chunkOf(x, z)
    return this.held.get(keyOf(cx, cz))?.blocks !== undefined
  }

  /** Keep the chunks around a column loaded, nearest first. */
  update(x: number, z: number): void {
    if (this.disposed) return
    this.frame += 1
    const [cx, cz] = LandingView.chunkOf(x, z)
    const reach = this.options.reach
    const wanted: { readonly cx: number; readonly cz: number; readonly gap: number }[] = []
    const across = AREA / CHUNK
    for (let dz = -reach; dz <= reach; dz += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const wx = cx + dx
        const wz = cz + dz
        if (wx < 0 || wz < 0 || wx >= across || wz >= across) continue
        if (dx * dx + dz * dz > reach * reach + 1) continue
        wanted.push({ cx: wx, cz: wz, gap: dx * dx + dz * dz })
      }
    }
    wanted.sort((a, b) => a.gap - b.gap)
    const shown = new Set<string>()
    for (const want of wanted) {
      const name = keyOf(want.cx, want.cz)
      shown.add(name)
      const chunk = this.held.get(name)
      if (chunk !== undefined) {
        chunk.usedAt = this.frame
        if (chunk.node !== undefined) chunk.node.visible = true
        continue
      }
      if (this.waiting >= this.options.inFlight) continue
      this.request(want.cx, want.cz)
    }
    for (const [name, chunk] of this.held) {
      if (shown.has(name)) continue
      if (chunk.node !== undefined) chunk.node.visible = false
      // Let go of chunks well outside the reach.
      if (this.frame - chunk.usedAt > 600 && chunk.node !== undefined) {
        this.group.remove(chunk.node)
        free(chunk.node)
        this.held.delete(name)
      }
    }
  }

  dispose(): void {
    this.disposed = true
    for (const chunk of this.held.values()) if (chunk.node !== undefined) free(chunk.node)
    this.held.clear()
    this.solid.dispose()
    this.fluid.dispose()
  }

  private request(cx: number, cz: number): void {
    const name = keyOf(cx, cz)
    const chunk: Held = {
      cx,
      cz,
      node: undefined,
      blocks: undefined,
      requested: true,
      usedAt: this.frame,
    }
    this.held.set(name, chunk)
    this.waiting += 1
    void this.builder
      .chunk(this.planet.seed, this.planet.dials, this.origin, cx, cz, [...this.edits])
      .then(({ mesh, blocks, roots }) => {
        this.waiting -= 1
        if (this.disposed || this.held.get(name) !== chunk) return
        for (const [x, z, row, id] of roots) this.roots.set(columnKey(x, z), { row, id })
        chunk.blocks = blocks
        chunk.node = this.nodeFor(mesh, cx, cz)
        this.group.add(chunk.node)
      })
  }

  private nodeFor(mesh: ChunkMesh, cx: number, cz: number): THREE.Group {
    const node = new THREE.Group()
    node.position.set(cx * CHUNK, 0, cz * CHUNK)
    if (mesh.index.length > 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colours, 3))
      geometry.setAttribute('tile', new THREE.BufferAttribute(mesh.tiles, 1))
      geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2))
      geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1))
      geometry.computeBoundingSphere()
      const ground = new THREE.Mesh(geometry, this.solid)
      ground.castShadow = true
      ground.receiveShadow = true
      node.add(ground)
    }
    if (mesh.fluid.index.length > 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.fluid.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.fluid.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.fluid.index, 1))
      geometry.computeBoundingSphere()
      const water = new THREE.Mesh(geometry, this.fluid)
      water.renderOrder = 1
      node.add(water)
    }
    return node
  }
}

function free(node: THREE.Group): void {
  node.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry: unknown = child.geometry
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
    }
  })
}
