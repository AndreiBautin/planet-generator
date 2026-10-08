import { withMoonlight } from './moonlight'
import * as THREE from 'three'

import { TOWN_GLOW_GLSL, withTownGlow } from './town-glow'
import { VALLEY_FOG } from './valley-fog'

/**
 * Weathering: what takes a model from looking made in a modelling program
 * to looking as if it stood out in the weather, shared by every built and
 * grown thing on the ground (ruins, sea stacks, bridges, lighthouses,
 * herds, wagons, ships, palms and camels; the houses take the first two).
 *
 * - **Rough**: every vertex nudged a little by a hash of where it is in the
 *   model, so a block is not a perfect box and no two stones of a ruin are
 *   cut alike. Keyed on the position, not the vertex, so the corners that
 *   several faces share move together and nothing cracks open.
 * - **Mottle**: the colour patched lighter and darker at the grain given,
 *   each instance its own patches.
 * - **Top**: a colour gathered on the faces that look up — moss on old
 *   stone, dust, lichen — patchy rather than painted.
 * - **Foot**: darker low down, where the ground's wet and dirt splash.
 * - **Shade and its own light**: the sky's light in shade with most of its
 *   blue taken out, as for the trees, and a little light of the model's own
 *   colour so a shaded side is not black — faded with the sun where it
 *   stands, so nothing glows at night (the balloons and the oasis did).
 *
 * Wraps whatever shader patch the material already has, running it first.
 */
export interface Weathering {
  /** How far a vertex may be nudged, in the model's own units; 0 for none. */
  readonly rough: number
  /** How strongly the colour is patched, 0 to about 0.5. */
  readonly mottle: number
  /**
   * How many patches to a planet radius, measured on the model as placed —
   * so a big stone and a small one are patched at the same scale, where
   * measured in the model's own units a large slab had three patches.
   */
  readonly grain: number
  /** A colour gathered on upward faces, and how much of it at most. */
  readonly top?: { readonly colour: readonly [number, number, number]; readonly amount: number }
  /** How much darker the foot is, and up to what height in the model's units. */
  readonly foot?: { readonly dark: number; readonly height: number }
  /** How much light of its own colour it has by day. */
  readonly own: number
}

const NOISE = /* glsl */ `
float weatherHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float weatherNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(weatherHash(i), weatherHash(i + vec3(1, 0, 0)), f.x),
        mix(weatherHash(i + vec3(0, 1, 0)), weatherHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(weatherHash(i + vec3(0, 0, 1)), weatherHash(i + vec3(1, 0, 1)), f.x),
        mix(weatherHash(i + vec3(0, 1, 1)), weatherHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`

const glslFloat = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : value.toFixed(5)
const glslVec3 = (c: readonly [number, number, number]): string =>
  `vec3(${glslFloat(c[0])}, ${glslFloat(c[1])}, ${glslFloat(c[2])})`

export function weather(material: THREE.Material, w: Weathering): void {
  const before = material.onBeforeCompile.bind(material)
  const beforeKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer)
    shader.uniforms.weatherSun = VALLEY_FOG.sun
    withTownGlow(shader.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${NOISE}\nvarying vec3 vWeatherLocal;\nvarying vec3 vWeatherPlaced;\nvarying vec3 vWeatherWorld;\nvarying vec3 vWeatherNormal;\nvarying vec3 vWeatherViewUp;\nvarying float vWeatherSeed;\nvoid main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            mat4 weatherModel = modelMatrix * instanceMatrix;
            vec3 weatherAt = instanceMatrix[3].xyz;
            mat4 weatherPlace = instanceMatrix;
          #else
            mat4 weatherModel = modelMatrix;
            vec3 weatherAt = vec3(0.0);
            mat4 weatherPlace = mat4(1.0);
          #endif
          vWeatherSeed = weatherHash(weatherAt * 5717.0);
          ${
            w.rough > 0
              ? `transformed += (vec3(
            weatherHash(position * 31.7 + vWeatherSeed * 13.0),
            weatherHash(position * 47.3 + vWeatherSeed * 29.0),
            weatherHash(position * 23.9 + vWeatherSeed * 41.0)) - 0.5) * ${glslFloat(w.rough * 2)};`
              : ''
          }
          vWeatherLocal = position;
          vWeatherPlaced = (weatherPlace * vec4(transformed, 1.0)).xyz;
          vWeatherWorld = (weatherModel * vec4(transformed, 1.0)).xyz;
          vWeatherNormal = normalize(mat3(weatherModel) * objectNormal);
          vWeatherViewUp = normalize(mat3(viewMatrix) * normalize(vWeatherWorld));
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `${NOISE}\n${TOWN_GLOW_GLSL}\nuniform vec3 weatherSun;\nvarying vec3 vWeatherLocal;\nvarying vec3 vWeatherPlaced;\nvarying vec3 vWeatherWorld;\nvarying vec3 vWeatherNormal;\nvarying vec3 vWeatherViewUp;\nvarying float vWeatherSeed;\nvoid main() {`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 weatherP = vWeatherPlaced * ${glslFloat(w.grain)} + vWeatherSeed * 17.0;
          float weatherN = weatherNoise(weatherP) * 0.65 + weatherNoise(weatherP * 2.7) * 0.35;
          diffuseColor.rgb *= 1.0 + (weatherN - 0.5) * ${glslFloat(w.mottle * 2)};
          ${
            w.top === undefined
              ? ''
              : `// Up-ness of the facet as drawn, from its own slope on screen: the
          // models' smoothed normals lean upward towards a top edge, and a
          // sea stack's sides took the moss in blotches, like camouflage.
          // Scaled before crossing: a pixel's step across a small model is
          // tiny, and its square underflowed to a face facing nowhere.
          vec3 weatherDx = dFdx(vViewPosition);
          vec3 weatherDy = dFdy(vViewPosition);
          float weatherSpan = max(max(length(weatherDx), length(weatherDy)), 1e-20);
          vec3 weatherFace = normalize(cross(weatherDx / weatherSpan, weatherDy / weatherSpan));
          // Turned to face the eye, as any drawn face does: three's
          // vViewPosition runs from the surface to the eye.
          if (dot(weatherFace, vViewPosition) < 0.0) weatherFace = -weatherFace;
          float weatherUpness = dot(weatherFace, vWeatherViewUp);
          float weatherTop = smoothstep(0.35, 0.75, weatherUpness) * smoothstep(0.38, 0.55, weatherN);
          diffuseColor.rgb = mix(diffuseColor.rgb, ${glslVec3(w.top.colour)}, weatherTop * ${glslFloat(w.top.amount)});`
          }
          ${
            w.foot === undefined
              ? ''
              : `diffuseColor.rgb *= mix(${glslFloat(1 - w.foot.dark)}, 1.0, smoothstep(0.0, ${glslFloat(w.foot.height)}, vWeatherLocal.y));`
          }
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float weatherDay = smoothstep(-0.1, 0.15, dot(normalize(vWeatherWorld), normalize(weatherSun)));
        totalEmissiveRadiance += diffuseColor.rgb * ${glslFloat(w.own)} * weatherDay;
        // The towns' light at night on whatever stands round them (town-glow.ts).
        totalEmissiveRadiance += diffuseColor.rgb * townGlowAt(vWeatherPlaced) * 0.7;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse = mix(
          reflectedLight.indirectDiffuse,
          vec3(dot(reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114))),
          0.65
        );
        // No sun past the terminator, as for the ground and the trees: lit
        // by the sun through the planet, the ruins glowed a dusky red at
        // midnight.
        #if NUM_DIR_LIGHTS > 0
        {
          float weatherLit = smoothstep(-0.05, 0.08, dot(vWeatherViewUp, directionalLights[0].direction));
          reflectedLight.directDiffuse *= weatherLit;
          reflectedLight.directSpecular *= weatherLit;
        }
        #endif`,
      )
    withMoonlight(shader)
  }
  const key = JSON.stringify(w)
  material.customProgramCacheKey = () => `${beforeKey()}|weathered|${key}`
}
