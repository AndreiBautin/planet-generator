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
 * Lit like the ground, so clouds on the night side fall dark with it. Seen
 * from below only when the camera is below them (`cloudsSeenFrom`): drawn
 * from both sides always, the far side's undersides lit up along the night
 * limb as a dotted white arc.
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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 192, 96), material)
  mesh.renderOrder = 2
  return mesh
}

/**
 * Adjust the clouds for where the camera is: their undersides drawn only
 * from beneath them, and faded out as the camera comes close to the layer.
 * A cloud texture is soft by design, and at arm's length it is a blur that
 * fills the screen; flying through it should feel like passing a veil, not
 * like the lens fogging up.
 */
export function cloudsSeenFrom(
  clouds: THREE.Mesh,
  distance: number,
  scale: number,
  strength: number,
): void {
  const material: unknown = clouds.material
  if (!(material instanceof THREE.Material)) return
  const layer = CLOUD_RADIUS * scale
  const side = distance < layer ? THREE.DoubleSide : THREE.FrontSide
  if (material.side !== side) {
    material.side = side
    material.needsUpdate = true
  }
  const gap = Math.abs(distance - layer)
  const t = Math.min(1, Math.max(0, (gap - 0.004) / 0.03))
  material.opacity = CLOUD_OPACITY * strength * t * t * (3 - 2 * t)
}
