import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import { fromPalette } from '../colour'
import type { GroundTextures } from '../textures'

/**
 * The materials a landing's chunks are drawn with.
 *
 * The ground: one material for every block. A face says which of the
 * ground photographs it wears (`tile`) and where on it (`uv`, in blocks);
 * the shader samples that photograph, levels it to its own brightness and
 * multiplies the face's tint — the biome's colour darkened in the corners
 * — so a block of this world's grass is this world's green with grass's
 * grain on it, and the same stone photograph serves a grey cliff and a red
 * desert. A photograph repeats every eight blocks.
 *
 * The fluid: the planet's own water colour, transparent, or its lava,
 * lit from within.
 */
export function chunkMaterial(textures: GroundTextures): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  })
  material.onBeforeCompile = (shader) => {
    const kinds = ['grass', 'litter', 'sand', 'stone', 'snow', 'basalt'] as const
    let declare = ''
    kinds.forEach((kind, which) => {
      shader.uniforms[`chunkTex${String(which)}`] = textures[kind].color
      shader.uniforms[`chunkMean${String(which)}`] = textures[kind].mean
      declare += `uniform sampler2D chunkTex${String(which)};\nuniform float chunkMean${String(which)};\n`
    })
    shader.vertexShader =
      'attribute float tile;\nvarying float vChunkTile;\nvarying vec2 vChunkUv;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vChunkTile = tile;\n  vChunkUv = uv / 8.0;',
      )
    shader.fragmentShader =
      declare +
      'varying float vChunkTile;\nvarying vec2 vChunkUv;\n' +
      /* glsl */ `
      vec3 chunkPhoto(float tile, vec2 uv) {
        int which = int(tile + 0.5);
        vec3 c;
        float mean;
        if (which == 0) { c = texture2D(chunkTex0, uv).rgb; mean = chunkMean0; }
        else if (which == 1) { c = texture2D(chunkTex1, uv).rgb; mean = chunkMean1; }
        else if (which == 2) { c = texture2D(chunkTex2, uv).rgb; mean = chunkMean2; }
        else if (which == 3) { c = texture2D(chunkTex3, uv).rgb; mean = chunkMean3; }
        else if (which == 4) { c = texture2D(chunkTex4, uv).rgb; mean = chunkMean4; }
        else if (which == 5) { c = texture2D(chunkTex5, uv).rgb; mean = chunkMean5; }
        else { c = vec3(1.0); mean = 0.5; }
        c /= mean * 2.0;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        return mix(vec3(lum), c, 0.35) * 2.0;
      }
      ` +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
        diffuseColor.rgb *= chunkPhoto(vChunkTile, vChunkUv);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * step(5.5, vChunkTile);`,
        )
  }
  material.customProgramCacheKey = () => 'planet-chunks'
  return material
}

export function fluidMaterial(planet: Planet): THREE.Material {
  if (planet.molten) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x1a0600),
      emissive: fromPalette(planet.palette.deep),
      emissiveIntensity: 1.6,
      roughness: 0.7,
      metalness: 0,
    })
  }
  return new THREE.MeshPhysicalMaterial({
    color: fromPalette(planet.palette.shallow).lerp(fromPalette(planet.palette.deep), 0.3),
    transparent: true,
    opacity: 0.6,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}
