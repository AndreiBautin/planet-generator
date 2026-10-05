import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { surfaceAt, type Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The planet's ground as a mesh: an icosphere (even triangles everywhere,
 * no poles to pinch), each vertex pushed out by the surface height and
 * painted the surface colour.
 *
 * Merged before the normals are computed — Three's icosphere repeats every
 * vertex per face, and normals averaged over unmerged vertices come out
 * flat-shaded, a faceted ball instead of a world.
 */
/** How far above the sea's surface the lowest land sits. */
const LAND_CLEARANCE = 0.003

export function buildPlanetMesh(planet: Planet, detail: number): THREE.Mesh {
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

  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  })
  return new THREE.Mesh(geometry, material)
}
