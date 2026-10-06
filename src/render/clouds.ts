import * as THREE from 'three'

import { KINDS } from '@/generation/kinds'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'
import { DETAIL_CLOUD_MOONS, MOON_SHADOW } from './eclipse'
import { CLOUD_FLOW, CLOUD_FLOW_LIFE, FLOW_GLSL } from './winds'
import {
  DETAIL_CLOUD_LAYER_SUN,
  DETAIL_RING_BANDS,
  DETAIL_RINGS,
  DETAIL_TIME,
  LIGHTNING,
  NOISE,
  RING_SHADOW,
} from './detail'

/**
 * The cloud layer: a sphere just above the highest ground, its opacity a
 * texture baked once (`bakeClouds`). Baked rather than shaded per frame
 * because the map itself does not change — only how the winds carry it —
 * and a phone should spend its frame on drawing, not on noise.
 *
 * Lit like the ground, so clouds on the night side fall dark with it. Seen
 * from below only when the camera is below them (`cloudsSeenFrom`): drawn
 * from both sides always, the far side's undersides lit up along the night
 * limb as a dotted white arc.
 *
 * Carried by the winds (winds.ts): where the map is read moves with the
 * latitude, so the weather travels.
 *
 * Alive, in the shader: the baked map says where the cloud is, and a slow
 * noise bends where it is read and breaks its edges into billows that
 * change over a minute or two, so the layer churns rather than turning as
 * one printed sheet. The map's own data is kept on the mesh (`cloudDataOf`)
 * for anything that wants to ask how heavy the cloud is over a point.
 */
export const CLOUD_RADIUS = 1.035
export const CLOUD_OPACITY = 0.8

/**
 * The layers drawn from one baked map. A single shell is a printed sheet
 * however well it churns: seen at a grazing angle from a glide it has no
 * body. So the deck is two shells — a greyer base, and above it brighter
 * tops only where the cover is thickest — which part as the eye moves and
 * read as height. Above both, a thin high layer of cirrus, streaked along
 * the lines of latitude as high wind draws it, made in the shader with no
 * map of its own.
 */
type Layer = 'base' | 'tops' | 'cirrus'
const LAYERS: Readonly<Record<Layer, { readonly radius: number; readonly opacity: number }>> = {
  base: { radius: CLOUD_RADIUS, opacity: CLOUD_OPACITY },
  tops: { radius: CLOUD_RADIUS + 0.0035, opacity: 0.85 },
  cirrus: { radius: 1.058, opacity: 0.3 },
}

const SHAPES: Readonly<Record<Layer, string>> = {
  base: /* glsl */ `
          float shaped = smoothstep(0.28, 0.78, cover + (billow - 0.5) * 0.5);
          diffuseColor.a *= shaped;
          // The underside of the deck: greyer, and greyest under the thickest
          // cloud — a storm's base is slate, not a paler white.
          diffuseColor.rgb *= (0.74 + billow * 0.26) * (1.0 - smoothstep(0.6, 1.0, cover) * 0.18);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.42, 0.46, 0.55), smoothstep(0.74, 0.92, cover));
          // Lit from inside by lightning, round where it struck.
          float struck = acos(clamp(dot(normalize(vCloudDir), cloudLightning.xyz), -1.0, 1.0));
          cloudFlash = cloudLightning.w * exp(-pow(struck / 0.035, 2.0)) * smoothstep(0.6, 0.9, cover);`,
  tops: /* glsl */ `
          float shaped = smoothstep(0.52, 0.9, cover + (billow - 0.5) * 0.6);
          // Only from above. Seen edge-on, from a glide near the clouds'
          // height, the two shells read as a slab with its sides missing,
          // the gaps in the billows hanging down it as streaks of sky.
          float looking = abs(dot(normalize(vViewPosition), normalize(vNormal)));
          diffuseColor.a *= shaped * smoothstep(0.12, 0.35, looking);
          // Sunlit tops: the brightest thing in the sky after the sun.
          diffuseColor.rgb *= 1.02 + billow * 0.12;`,
  cirrus: /* glsl */ `
          vec3 d = vCloudDir;
          // Streaks: fine across latitude, long along it. The latitude they
          // are read at is bent by a broad noise so they sweep in arcs, and
          // a second noise along them breaks each into wisps, or they read
          // as ruled lines.
          float bend = (detailNoise(d * 4.0 + t * 0.4) - 0.5) * 0.09 + (detailNoise(d * 11.0 - t * 0.6) - 0.5) * 0.025;
          float streak = detailNoise(vec3(d.x * 3.0, (d.y + bend) * 46.0, d.z * 3.0) + vec3(t, 0.0, -t));
          float wisps = smoothstep(0.35, 0.7, detailNoise(vec3(d.x * 22.0, d.y * 9.0, d.z * 22.0) - t * 0.8));
          float patches = smoothstep(0.5, 0.78, detailNoise(d * 2.2 + 31.0 - t * 0.3));
          // Sparse where the low cloud is thick, as weather fills the sky one way or the other.
          diffuseColor.a *= smoothstep(0.58, 0.9, streak) * wisps * patches * (1.0 - cover * 0.7);
          diffuseColor.rgb *= 1.05;`,
}

function layerMaterial(planet: Planet, texture: THREE.Texture, layer: Layer): THREE.Material {
  const material = new THREE.MeshStandardMaterial({
    color: fromPalette(KINDS[planet.kind].cloudColour),
    alphaMap: texture,
    transparent: true,
    opacity: LAYERS[layer].opacity,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cloudTime = DETAIL_TIME
    shader.uniforms.cloudLightning = LIGHTNING
    shader.uniforms.detailRings = DETAIL_RINGS
    shader.uniforms.detailRingBands = DETAIL_RING_BANDS
    shader.uniforms.cloudRingSun = DETAIL_CLOUD_LAYER_SUN
    // The moons in the cloud layer's own frame, which turns a little faster.
    shader.uniforms.detailMoons = DETAIL_CLOUD_MOONS
    // Carried by the winds (winds.ts).
    shader.uniforms.cloudFlow = CLOUD_FLOW
    shader.uniforms.cloudFlowLife = CLOUD_FLOW_LIFE
    shader.vertexShader =
      'varying vec3 vCloudDir;\nvarying vec3 vCloudUp;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vCloudDir = normalize(position);\n  vCloudUp = normalize(normalMatrix * normalize(position));',
      )
    shader.fragmentShader =
      'uniform float cloudTime;\nuniform vec4 cloudLightning;\nuniform vec2 detailRings;\nuniform vec4 detailRingBands[16];\nuniform vec3 cloudRingSun;\nuniform vec4 detailMoons[2];\nuniform vec4 cloudFlow;\nuniform vec2 cloudFlowLife;\nvarying vec3 vCloudDir;\nvarying vec3 vCloudUp;\nfloat cloudFlash = 0.0;\n' +
      NOISE +
      FLOW_GLSL +
      RING_SHADOW +
      MOON_SHADOW +
      shader.fragmentShader
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n        totalEmissiveRadiance += vec3(0.85, 0.85, 1.0) * cloudFlash * 2.5;',
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
        // No sun past the terminator: a cloud's flank still turned towards
        // a sun already set glowed red over the dark side.
        #if NUM_DIR_LIGHTS > 0
        {
          float cloudDay = smoothstep(-0.08, 0.06, dot(normalize(vCloudUp), directionalLights[0].direction));
          // And the rings' bands lie across the clouds as across the land.
          cloudDay *= 1.0 - ringShadowFrom(vCloudDir, cloudRingSun);
          // And an eclipse's shadow over them (eclipse.ts).
          cloudDay *= 1.0 - moonShadowFrom(vCloudDir, cloudRingSun);
          reflectedLight.directDiffuse *= cloudDay;
          reflectedLight.directSpecular *= cloudDay;
        }
        #endif`,
        )
        .replace(
          '#include <alphamap_fragment>',
          /* glsl */ `
        {
          float t = cloudTime * 0.012;
          // Bend where the map is read, slowly, so the shapes drift and
          // deform rather than scroll.
          vec2 warp = vec2(
            detailNoise(vCloudDir * 5.0 + t) - 0.5,
            detailNoise(vCloudDir * 5.0 + 11.0 - t) - 0.5) * 0.012;
          // Carried by the winds, as two copies of the map (winds.ts).
          float cover = flowBlend(
            texture2D(alphaMap, flowUv(vAlphaMapUv, 0) + warp).g,
            texture2D(alphaMap, flowUv(vAlphaMapUv, 1) + warp).g);
          // Billows: finer noise rolling through, breaking the edges up.
          float billow =
            detailNoise(vCloudDir * 48.0 + vec3(t * 1.6, -t, t * 0.7)) * 0.6 +
            detailNoise(vCloudDir * 130.0 - vec3(t * 2.5, t * 1.1, -t * 1.8)) * 0.4;
          ${SHAPES[layer]}
        }`,
        )
  }
  material.customProgramCacheKey = () => `planet-clouds-${layer}`
  return material
}

export function cloudsFromTexture(
  planet: Planet,
  data: Uint8Array,
  width: number,
  shells: { readonly segments: number; readonly cirrus: boolean } = { segments: 192, cirrus: true },
): THREE.Mesh {
  const texture = new THREE.DataTexture(data, width, width / 2)
  texture.wrapS = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const shell = (layer: Layer, segments: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(LAYERS[layer].radius, segments, segments / 2),
      layerMaterial(planet, texture, layer),
    )
    mesh.userData.layer = layer
    return mesh
  }
  // Segments in pairs, as a sphere's are: round, and half as many up it.
  const round = Math.max(32, Math.round(shells.segments / 2) * 2)
  const base = shell('base', round)
  base.renderOrder = 2
  const tops = shell('tops', round)
  tops.renderOrder = 3
  // Children of the base deck, so they turn, scale and are released with it.
  base.add(tops)
  if (shells.cirrus) {
    const cirrus = shell('cirrus', Math.max(32, round / 2))
    cirrus.renderOrder = 4
    base.add(cirrus)
  }
  base.userData.cloud = { data, width }
  return base
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
  clouds.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const material: unknown = node.material
    const held: unknown = node.userData.layer
    if (!(material instanceof THREE.Material) || typeof held !== 'string' || !(held in LAYERS))
      return
    const { radius, opacity } = LAYERS[held as Layer]
    const layer = radius * scale
    const side = distance < layer ? THREE.DoubleSide : THREE.FrontSide
    if (material.side !== side) {
      material.side = side
      material.needsUpdate = true
    }
    const gap = Math.abs(distance - layer)
    const t = Math.min(1, Math.max(0, (gap - 0.004) / 0.03))
    material.opacity = opacity * strength * t * t * (3 - 2 * t)
  })
}
