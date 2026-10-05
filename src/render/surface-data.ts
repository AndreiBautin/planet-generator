import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { cloudDensityAt } from '@/generation/clouds'
import { surfaceAt, type Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The slow half of drawing a planet: sampling the surface at every vertex
 * and the clouds at every texel. Kept apart from the meshes, as plain typed
 * arrays, so it can run in a worker and hand its results across without a
 * copy — the page keeps animating while a world is being made.
 *
 * Nothing in here touches the DOM or a GPU; Three is used only for its
 * icosphere and its vertex merging.
 */
export interface SurfaceData {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colours: Float32Array
  readonly index: Uint32Array
}

/** How far above the sea's surface the lowest land sits. */
const LAND_CLEARANCE = 0.003

/**
 * An icosphere (even triangles everywhere, no poles to pinch), each vertex
 * pushed out by the surface height and painted the surface colour.
 *
 * Merged before the normals are computed — Three's icosphere repeats every
 * vertex per face, and normals averaged over unmerged vertices come out
 * flat-shaded, a faceted ball instead of a world.
 */
export function sampleSurface(planet: Planet, detail: number): SurfaceData {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, detail))
  const position = geometry.getAttribute('position')
  const colours = new Float32Array(position.count * 3)

  for (let at = 0; at < position.count; at += 1) {
    const x = position.getX(at)
    const y = position.getY(at)
    const z = position.getZ(at)
    const { height, colour } = surfaceAt(planet, x, y, z)
    // Land rises with the relief, starting just clear of the water so the
    // coast does not flicker where the two surfaces meet; the sea floor
    // sinks more gently, so the water over it is shallow at the coast.
    const lift =
      height > 0 ? LAND_CLEARANCE + height * planet.relief * 0.7 : height * planet.relief * 0.35
    const radius = 1 + lift
    const length = Math.hypot(x, y, z)
    position.setXYZ(at, (x / length) * radius, (y / length) * radius, (z / length) * radius)
    const linear = fromPalette(colour)
    colours[at * 3] = linear.r
    colours[at * 3 + 1] = linear.g
    colours[at * 3 + 2] = linear.b
  }
  geometry.computeVertexNormals()

  const index = geometry.getIndex()
  return {
    positions: Float32Array.from(position.array),
    normals: Float32Array.from(geometry.getAttribute('normal').array),
    colours,
    index: index === null ? new Uint32Array(0) : Uint32Array.from(index.array),
  }
}

/**
 * Cloud opacity as a texture the width given and half as tall, one byte a
 * texel (RGBA, so it uploads everywhere). Laid out as Three's sphere maps
 * it: v = 1 at the north pole, and a data texture's first row is v = 0, so
 * the rows run south to north.
 */
export function bakeClouds(planet: Planet, width: number): Uint8Array {
  const height = width / 2
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const theta = (1 - (row + 0.5) / height) * Math.PI
    const ring = Math.sin(theta)
    const y = Math.cos(theta)
    for (let column = 0; column < width; column += 1) {
      const phi = ((column + 0.5) / width) * Math.PI * 2
      const density = cloudDensityAt(planet, -Math.cos(phi) * ring, y, Math.sin(phi) * ring)
      const at = (row * width + column) * 4
      const value = Math.round(density * 255)
      data[at] = value
      data[at + 1] = value
      data[at + 2] = value
      data[at + 3] = 255
    }
  }
  return data
}
