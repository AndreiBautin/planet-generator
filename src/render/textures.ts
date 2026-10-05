import * as THREE from 'three'

import { bakeGroundTile, GROUND_KINDS, TILE, type GroundKind } from './ground-atlas'

/**
 * The baked ground tiles as GPU textures, made once for the page and shared
 * by every planet: they describe kinds of ground, not a planet, so a New
 * planet press reuses them. Repeating, mipmapped and anisotropic, which is
 * what keeps a texture laid across a plain from shimmering at a distance.
 *
 * Linear, not sRGB: the shader multiplies them into a colour already in
 * linear light, and the bake wrote linear values.
 */
export type GroundTextures = Readonly<Record<GroundKind, THREE.DataTexture>>

let shared: GroundTextures | undefined

export function groundTextures(): GroundTextures {
  if (shared !== undefined) return shared
  const made: Partial<Record<GroundKind, THREE.DataTexture>> = {}
  for (const kind of GROUND_KINDS) {
    const texture = new THREE.DataTexture(bakeGroundTile(kind).data, TILE, TILE, THREE.RGBAFormat)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 4
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    made[kind] = texture
  }
  shared = made as GroundTextures
  return shared
}
