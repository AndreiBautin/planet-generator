import * as THREE from 'three'

import type { SurfaceData } from './surface-data'

/** The planet's ground, from sampled surface data: vertex-coloured and matte. */
export function meshFromSurface(data: SurfaceData): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colours, 3))
  geometry.setIndex(new THREE.BufferAttribute(data.index, 1))
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  })
  return new THREE.Mesh(geometry, material)
}
