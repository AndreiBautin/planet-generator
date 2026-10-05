import * as THREE from 'three'

import { KINDS } from '@/generation/kinds'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The cloud layer: a sphere just above the highest ground, its opacity a
 * texture baked once (`bakeClouds`). Baked rather than shaded per frame
 * because the clouds' shape does not change — only their turn — and a phone
 * should spend its frame on drawing, not on noise.
 *
 * Lit like the ground, so clouds on the night side fall dark with it.
 */
export const CLOUD_RADIUS = 1.035
export const CLOUD_OPACITY = 0.8

export function cloudsFromTexture(planet: Planet, data: Uint8Array, width: number): THREE.Mesh {
  const texture = new THREE.DataTexture(data, width, width / 2)
  texture.wrapS = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const material = new THREE.MeshStandardMaterial({
    color: fromPalette(KINDS[planet.kind].cloudColour),
    alphaMap: texture,
    transparent: true,
    opacity: CLOUD_OPACITY,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 96, 48), material)
  mesh.renderOrder = 2
  return mesh
}
