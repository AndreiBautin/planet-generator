import * as THREE from 'three'

import { KINDS } from '@/generation/kinds'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'
import { DETAIL_TIME, NOISE } from './detail'

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
 *
 * Alive, in the shader: the baked map says where the cloud is, and a slow
 * noise bends where it is read and breaks its edges into billows that
 * change over a minute or two, so the layer churns rather than turning as
 * one printed sheet. The map's own data is kept on the mesh (`cloudDataOf`)
 * for anything that wants to ask how heavy the cloud is over a point.
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
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cloudTime = DETAIL_TIME
    shader.vertexShader =
      'varying vec3 vCloudDir;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vCloudDir = normalize(position);',
      )
    shader.fragmentShader =
      'uniform float cloudTime;\nvarying vec3 vCloudDir;\n' +
      NOISE +
      shader.fragmentShader.replace(
        '#include <alphamap_fragment>',
        /* glsl */ `
        {
          float t = cloudTime * 0.012;
          // Bend where the map is read, slowly, so the shapes drift and
          // deform rather than scroll.
          vec2 warp = vec2(
            detailNoise(vCloudDir * 5.0 + t) - 0.5,
            detailNoise(vCloudDir * 5.0 + 11.0 - t) - 0.5) * 0.012;
          float cover = texture2D(alphaMap, vAlphaMapUv + warp).g;
          // Billows: finer noise rolling through, breaking the edges up.
          float billow =
            detailNoise(vCloudDir * 48.0 + vec3(t * 1.6, -t, t * 0.7)) * 0.6 +
            detailNoise(vCloudDir * 130.0 - vec3(t * 2.5, t * 1.1, -t * 1.8)) * 0.4;
          float shaped = smoothstep(0.28, 0.78, cover + (billow - 0.5) * 0.5);
          diffuseColor.a *= shaped;
          // Thicker cloud is brighter on top and greyer underneath.
          diffuseColor.rgb *= 0.78 + billow * 0.3;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'planet-clouds'
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 192, 96), material)
  mesh.renderOrder = 2
  mesh.userData.cloud = { data, width }
  return mesh
}

/** The baked cloud map a layer was made from, for reading the cover over a point. */
export function cloudDataOf(
  clouds: THREE.Mesh,
): { readonly data: Uint8Array; readonly width: number } | undefined {
  const held: unknown = clouds.userData.cloud
  if (typeof held !== 'object' || held === null) return undefined
  const { data, width } = held as { data?: unknown; width?: unknown }
  if (!(data instanceof Uint8Array) || typeof width !== 'number') return undefined
  return { data, width }
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
