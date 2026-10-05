import type * as THREE from 'three'

/**
 * Detail finer than any patch carries, drawn per pixel: grain and small
 * bumps on the ground, and moving ripples on the water, near the camera.
 *
 * The mesh is only as fine as the patches can be made in time — a vertex
 * every few hundredths of a degree at best — so close up, land between
 * vertices was a smooth gradient of one colour, and a dive from orbit
 * ended in plastic. A noise sampled per pixel in the planet's own frame
 * costs no patches at all, sits still on the ground as the planet turns,
 * and fades out with distance, where it would only shimmer.
 *
 * Added to Three's own materials through `onBeforeCompile`, so the lighting,
 * the fog and the shadows of the standard material all still apply.
 */

/** Seconds, for the water's ripples; the scene advances it from the clock. */
export const DETAIL_TIME = { value: 0 }

const NOISE = /* glsl */ `
  varying vec3 vDetailPosition;
  // A hash that holds up at large coordinates, unlike the sin() kind,
  // which degrades on mobile GPUs well before a few thousand.
  float detailHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float detailNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(detailHash(i), detailHash(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(detailHash(i + vec3(0.0, 1.0, 0.0)), detailHash(i + vec3(1.0, 1.0, 0.0)), u.x),
        u.y),
      mix(
        mix(detailHash(i + vec3(0.0, 0.0, 1.0)), detailHash(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(detailHash(i + vec3(0.0, 1.0, 1.0)), detailHash(i + vec3(1.0, 1.0, 1.0)), u.x),
        u.y),
      u.z);
  }
  // Tilt a normal by a height's change across the pixel — Three's own bump
  // mapping, under another name so it cannot collide with a bump map's.
  vec3 detailBump(vec3 position, vec3 normal, vec2 slope, float facing) {
    vec3 sx = normalize(dFdx(position));
    vec3 sy = normalize(dFdy(position));
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1) * facing;
    vec3 grad = sign(det) * (slope.x * r1 + slope.y * r2);
    return normalize(abs(det) * normal - grad);
  }
`

const VARYING = /* glsl */ `
  varying vec3 vDetailPosition;
`

/** Pass the planet-frame position through, for noise that stays on the ground. */
function passPosition(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = VARYING + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vDetailPosition = position;',
  )
  shader.fragmentShader = NOISE + shader.fragmentShader
}

/** Grain in the ground's colour and small bumps in its light, near the camera. */
export function withGroundDetail(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    passPosition(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float detailDistance = length(vViewPosition);
        // Two scales: one a few metres across, seen from a low glide, and
        // one finer, seen only right above the ground.
        float detailNear = 1.0 - smoothstep(0.03, 0.4, detailDistance);
        float detailClose = 1.0 - smoothstep(0.008, 0.07, detailDistance);
        float detailHeight =
          (detailNoise(vDetailPosition * 650.0) - 0.5) * detailNear +
          (detailNoise(vDetailPosition * 2600.0) - 0.5) * 0.7 * detailClose;
        diffuseColor.rgb *= 1.0 + detailHeight * 0.45;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        normal = detailBump(
          -vViewPosition,
          normal,
          vec2(dFdx(detailHeight), dFdy(detailHeight)) * 0.9,
          faceDirection);`,
      )
  }
  material.customProgramCacheKey = () => 'planet-ground-detail'
  return material
}

/** Ripples moving across the water's surface, near the camera; the colour is left alone. */
export function withWaterDetail(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailTime = DETAIL_TIME
    passPosition(shader)
    shader.fragmentShader =
      'uniform float detailTime;\n' +
      shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          float rippleNear = 1.0 - smoothstep(0.02, 0.3, length(vViewPosition));
          vec3 drift = vec3(detailTime * 0.9, detailTime * 0.6, -detailTime * 0.7);
          float ripple =
            (detailNoise(vDetailPosition * 900.0 + drift) +
              detailNoise(vDetailPosition * 2200.0 - drift * 1.7) * 0.6) * rippleNear;
          normal = detailBump(
            -vViewPosition,
            normal,
            vec2(dFdx(ripple), dFdy(ripple)) * 0.5,
            faceDirection);
        }`,
      )
  }
  material.customProgramCacheKey = () => 'planet-water-detail'
  return material
}
