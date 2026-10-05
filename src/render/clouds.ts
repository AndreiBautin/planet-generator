import * as THREE from 'three'

import { cloudDensityAt } from '@/generation/clouds'
import { KINDS } from '@/generation/kinds'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The cloud layer: a sphere just above the highest ground, its opacity a
 * texture baked once from `cloudDensityAt`. Baked rather than shaded per
 * frame because the clouds' shape does not change — only their turn — and
 * a phone should spend its frame on drawing, not on noise.
 *
 * Lit like the ground, so clouds on the night side fall dark with it.
 */
export const CLOUD_RADIUS = 1.035

export function buildClouds(planet: Planet, width: number): THREE.Mesh {
  const height = width / 2
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    // Three's sphere puts v = 1 at the north pole; a data texture's first
    // row is v = 0, so the rows run south to north.
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
  const texture = new THREE.DataTexture(data, width, height)
  texture.wrapS = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const material = new THREE.MeshStandardMaterial({
    color: fromPalette(KINDS[planet.kind].cloudColour),
    alphaMap: texture,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 96, 48), material)
  mesh.renderOrder = 2
  return mesh
}
