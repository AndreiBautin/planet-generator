import * as THREE from 'three'

import { TERRAIN_PATCHES } from '../detail'
import { patchIndex, quarterIndex } from './patch-data'

/**
 * The ground of every patch in one `BatchedMesh`: one draw a pass where
 * there were 330 in a glide (a patch drawn whole, or one to four quarters
 * of it, each its own mesh). Behind `?batch` while it is a prototype.
 *
 * A batch draws each patch's whole index, so the quarters are hidden in the
 * vertex shader instead: the layout gives every quarter its own copies of
 * the vertices it shares with another (the midlines), so each vertex
 * belongs to exactly one quarter and a hidden quarter's triangles are all
 * moved out of the view. What changes per patch — which quarters show, the
 * four edges' stitch and the arrival — is four numbers and a mask a patch,
 * in a small texture the vertex shader reads (`TERRAIN_PATCHES`), not
 * vertex attributes rewritten on the CPU.
 */
export interface BatchLayout {
  /** For each vertex of the layout, the patch vertex it copies. */
  readonly source: Uint32Array
  /** For each vertex: its quarter, its grid column and row, and its skirt's edge (−1 on the grid). */
  readonly cell: Float32Array
  readonly index: Uint32Array
}

const layouts = new Map<number, BatchLayout>()

export function batchLayout(segments: number): BatchLayout {
  const known = layouts.get(segments)
  if (known !== undefined) return known
  const side = segments + 1
  const grid = side * side
  const source: number[] = []
  const cell: number[] = []
  const index: number[] = []
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const copies = new Map<number, number>()
    for (const vertex of quarterIndex(segments, quarter)) {
      let at = copies.get(vertex)
      if (at === undefined) {
        at = source.length
        copies.set(vertex, at)
        source.push(vertex)
        const skirt = vertex >= grid ? Math.floor((vertex - grid) / side) : -1
        const i = vertex < grid ? vertex % side : 0
        const j = vertex < grid ? Math.floor(vertex / side) : 0
        cell.push(quarter, i, j, skirt)
      }
      index.push(at)
    }
  }
  const made = {
    source: Uint32Array.from(source),
    cell: Float32Array.from(cell),
    index: Uint32Array.from(index),
  }
  layouts.set(segments, made)
  return made
}

/** The whole patch's triangles, for a test to compare the layout's against. */
export const wholeIndex = patchIndex

/** Texels a patch takes in the state texture: the edges, then the mask and the arrival. */
const TEXELS = 2

/** The attributes a patch's ground carries, by name and size, as `nodeFor` builds them. */
export type GroundArrays = Readonly<
  Record<
    string,
    {
      readonly array: ArrayLike<number>
      readonly size: number
      readonly stride?: number
      readonly offset?: number
    }
  >
>

interface Slot {
  readonly geometry: number
  readonly instance: number
}

/** The private parts of a geometry's record a refill must update (BatchedMesh keeps no setter). */
interface GeometryRecord {
  vertexStart: number
  boundingSphere: THREE.Sphere | null
}

export class GroundBatch {
  readonly mesh: THREE.BatchedMesh
  private readonly layout: BatchLayout
  private readonly texture: THREE.DataTexture
  private readonly free: Slot[] = []
  private readonly capacity: number
  private dirty = false

  constructor(segments: number, capacity: number, material: THREE.Material, depth: THREE.Material) {
    this.layout = batchLayout(segments)
    this.capacity = capacity
    const vertices = this.layout.source.length
    this.mesh = new THREE.BatchedMesh(
      capacity,
      capacity * vertices,
      capacity * this.layout.index.length,
      material,
    )
    this.mesh.customDepthMaterial = depth
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    // Front to back, as three sorts separate meshes: unsorted, the ground's
    // heavy fragment shader ran under every patch in turn and the GPU's
    // time over a tour went from 13 ms to 46.
    this.mesh.sortObjects = true
    const width = 256
    const height = Math.ceil((capacity * TEXELS) / width)
    this.texture = new THREE.DataTexture(
      new Float32Array(width * height * 4),
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    this.texture.needsUpdate = true
  }

  /** Put a patch's ground in the batch, hidden; returns its slot. */
  add(arrays: GroundArrays, sphere: THREE.Sphere): Slot {
    const reused = this.free.pop()
    if (reused === undefined) {
      const geometry = this.mesh.addGeometry(this.geometryOf(arrays, sphere))
      const instance = this.mesh.addInstance(geometry)
      this.mesh.setVisibleAt(instance, false)
      this.state(instance, 0, [0, 0, 0, 0], 0)
      return { geometry, instance }
    }
    this.refill(reused.geometry, arrays, sphere)
    this.mesh.setVisibleAt(reused.instance, false)
    this.state(reused.instance, 0, [0, 0, 0, 0], 0)
    return reused
  }

  remove(slot: Slot): void {
    this.mesh.setVisibleAt(slot.instance, false)
    this.free.push(slot)
  }

  get full(): boolean {
    return this.free.length === 0 && this.mesh.instanceCount >= this.capacity
  }

  show(slot: Slot, visible: boolean): void {
    if (this.mesh.getVisibleAt(slot.instance) !== visible)
      this.mesh.setVisibleAt(slot.instance, visible)
  }

  /** Which quarters show (a bit each), the four edges' stitch and the arrival. */
  state(instance: number, mask: number, edges: readonly number[], arrival: number): void {
    const data = this.texture.image.data as Float32Array
    const at = instance * TEXELS * 4
    for (let k = 0; k < 4; k += 1) data[at + k] = edges[k] ?? 0
    data[at + 4] = mask
    data[at + 5] = arrival
    this.dirty = true
  }

  /** Before drawing: hand the shaders this batch's state. */
  frame(): void {
    TERRAIN_PATCHES.value = this.texture
    if (this.dirty) this.texture.needsUpdate = true
    this.dirty = false
  }

  dispose(): void {
    this.mesh.dispose()
    this.texture.dispose()
  }

  private geometryOf(arrays: GroundArrays, sphere: THREE.Sphere): THREE.BufferGeometry {
    const { source, cell, index } = this.layout
    const geometry = new THREE.BufferGeometry()
    for (const [name, { array, size, stride = size, offset = 0 }] of Object.entries(arrays)) {
      const out = new Float32Array(source.length * size)
      source.forEach((from, k) => {
        for (let c = 0; c < size; c += 1) out[k * size + c] = array[from * stride + offset + c] ?? 0
      })
      geometry.setAttribute(name, new THREE.BufferAttribute(out, size))
    }
    geometry.setAttribute('patchCell', new THREE.BufferAttribute(cell, 4))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    geometry.boundingSphere = sphere.clone()
    return geometry
  }

  /** Write a patch's arrays straight into a reused geometry's range: setGeometryAt copies a component at a time. */
  private refill(id: number, arrays: GroundArrays, sphere: THREE.Sphere): void {
    const records = (this.mesh as unknown as { _geometryInfo: GeometryRecord[] })._geometryInfo
    const record = records[id]
    if (record === undefined) return
    const { source } = this.layout
    for (const [name, { array, size, stride = size, offset = 0 }] of Object.entries(arrays)) {
      const attribute = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute
      const out = attribute.array as Float32Array
      const base = record.vertexStart * size
      source.forEach((from, k) => {
        for (let c = 0; c < size; c += 1)
          out[base + k * size + c] = array[from * stride + offset + c] ?? 0
      })
      attribute.addUpdateRange(base, source.length * size)
      attribute.needsUpdate = true
    }
    if (record.boundingSphere === null) record.boundingSphere = sphere.clone()
    else record.boundingSphere.copy(sphere)
  }
}
