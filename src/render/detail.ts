import * as THREE from 'three'

import { HAZE_SUN } from './haze'
import { DETAIL_MOONS, MOON_SHADOW } from './eclipse'
import { withMoonlight } from './moonlight'
import { CLOUD_FLOW, CLOUD_FLOW_LIFE, FLOW_GLSL } from './winds'

/**
 * Detail finer than any patch carries, drawn per pixel, so that up close
 * every kind of ground and sea has a texture of its own rather than a
 * smooth wash of one colour.
 *
 * - **Ground**: the baked ground textures (`ground-atlas.ts`) laid on
 *   triplanar and blended by what the ground is — turf, forest litter, sand,
 *   stone, snow, basalt — with their heights bumping the surface; grain and
 *   small bumps on top; and four patterns weighted by `patternAt`: a forest
 *   seen from above breaks into tree crowns, sand into wind ripples, snow
 *   into carved ridges with the odd glint, and stone into cracks. The
 *   patterns carry the look beyond where single trees and rocks stand.
 * - **Sea**: moving ripples, foam where it meets a coast, the odd whitecap,
 *   and lighter water over the shallows.
 * - **Lava**: a crust of plates drifting slowly, split by glowing seams that
 *   pulse.
 *
 * All sampled in the planet's own frame, so it sits still on the ground as
 * the planet turns, and faded out with distance, where it would only
 * shimmer. Added to Three's own materials through `onBeforeCompile`, so the
 * lighting and the fog of the standard material still apply.
 */

/** Seconds, for the water and the lava; the scene advances it from the clock. */
export const DETAIL_TIME = { value: 0 }
/**
 * How far from the camera single features stand, in planet radii: inside
 * it the ground draws a biome's floor, beyond it a picture of the biome.
 */
export const DETAIL_RANGE = { value: 0.1 }
/** The cloud layer's opacity map, which the ground and sea take shadows from; null while none is baked. */
export const DETAIL_CLOUDS: { value: THREE.Texture | null } = { value: null }
/** How far the clouds have turned ahead of the ground, in radians about y. */
export const DETAIL_CLOUD_SPIN = { value: 0 }
/** The sun's direction in the planet's frame, for where a cloud's shadow falls. */
export const DETAIL_CLOUD_SUN = { value: new THREE.Vector3(1, 0, 0) }
/** The sun in the cloud layer's own frame, which turns a little ahead of the ground's: for the rings' shadow on the clouds. */
export const DETAIL_CLOUD_LAYER_SUN = { value: new THREE.Vector3(1, 0, 0) }
/**
 * Planet frame to view space for normals, set by the scene each frame: the
 * normal maps perturb a normal in the planet's frame, where the triplanar
 * axes live, and Three wants it in view space.
 */
export const DETAIL_NORMAL_MATRIX = { value: new THREE.Matrix3() }
/**
 * The sky's colour at the horizon, linear, set by the scene each frame from
 * the air around the eye: what the sea reflects at a grazing angle. Without
 * it the sea had nothing to mirror and went dark towards the horizon, a
 * black band under a bright sky.
 */
export const DETAIL_SKY = { value: new THREE.Color(0, 0, 0) }
/** A flash of lightning inside a storm: its direction in the cloud layer's frame (xyz) and how bright, 0 to 1 (w). */
export const LIGHTNING = { value: new THREE.Vector4(0, 1, 0, 0) }
/** The sky overhead, deeper than the haze at the horizon: what calm water mirrors looking down. */
export const DETAIL_ZENITH = { value: new THREE.Color(0, 0, 0) }
/**
 * The rings, for the shadow they throw on the ground: inner and outer edge
 * (x, y; nought for no rings) and their bands, 64 samples packed four to
 * a vector. Uniforms rather than a texture, as the ground's shader is
 * already near the number of textures a phone allows.
 */
export const DETAIL_RINGS = { value: new THREE.Vector2(0, 0) }
/** The towns' glow on the ground (settlements.ts, `townGlow`), and how strongly it shows: nought with none. */
export const DETAIL_CITIES: { value: THREE.Texture | null } = { value: null }
export const DETAIL_CITY_LIGHT = { value: 0 }
/** How strongly the aurora (aurora.ts) lights the ground under it on the night side; nought with none. */
export const DETAIL_AURORA = { value: 0 }
/** How far a pack-ice floe stands over the lead beside it, in planet radii: about a ship's height. */
export const ICE_HEIGHT = 0.0004
/** How far a lava plate stands proud of the melt in the seams, in planet radii. */
export const LAVA_PLATE_HEIGHT = 0.0005
/** How far under the sea the eye is, 0 to 1 (underwater.ts): caustics on the sea bed, the surface lit from below. */
export const DETAIL_UNDER = { value: 0 }
export const DETAIL_RING_BANDS = {
  value: Array.from({ length: 16 }, () => new THREE.Vector4()),
}

export const NOISE = /* glsl */ `
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
  // Cells: the distance to the nearest and second-nearest seed point, and an
  // id for the nearest. Crowns, cracks and lava plates are all cells.
  vec3 detailCells(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float f1 = 8.0;
    float f2 = 8.0;
    float id = 0.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 cell = i + g;
          vec3 o = vec3(detailHash(cell), detailHash(cell + 17.13), detailHash(cell + 41.7));
          vec3 r = g + o - f;
          float d = dot(r, r);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = detailHash(cell + 7.7);
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return vec3(sqrt(f1), sqrt(f2), id);
  }
  // Tilt a normal by a height's change across the pixel — Three's own bump
  // mapping, under another name so it cannot collide with a bump map's.
  // Pack ice as a surface, not a paint: floes standing over the leads
  // between them, a pressure ridge where floes meet, a slab's own gentle
  // dome and hummocks over it. 0 in a lead, about 1 on a floe. Read by the
  // water's vertex shader (to raise the floes) and its fragment shader (to
  // light their edges and paint them), so the two cannot disagree.
  float iceRelief(vec3 p) {
    float n = abs(detailNoise(p * 600.0) - 0.5);
    float lead = 1.0 - smoothstep(0.0, 0.05, n);
    float ridge = smoothstep(0.05, 0.09, n) * (1.0 - smoothstep(0.09, 0.16, n));
    float slab = detailNoise(p * 160.0);
    float hummock = detailNoise(p * 1400.0);
    return (1.0 - lead) * (0.6 + 0.25 * slab + 0.15 * hummock) + ridge * 0.45;
  }
  // The lava sea's crust: plates carried on a current, read twice half a
  // cycle apart and cross-faded (flow mapping, which lets a pattern move
  // without stretching for ever). Returns the seam (1 in the glowing
  // crack between plates), the plate's id, and a height: plates stand
  // proud with their rims sagging to the seams, ropes of cooled crust
  // wrinkling their tops. One function for the vertex shader (which lifts
  // the plates) and the fragment (which lights and paints them).
  vec3 lavaPlates(vec3 p, float time) {
    vec3 up = normalize(p);
    vec3 current = vec3(
      detailNoise(p * 9.0 + 3.1),
      detailNoise(p * 9.0 + 7.7),
      detailNoise(p * 9.0 + 1.3)) - 0.5;
    current -= up * dot(current, up);
    current = normalize(current + 1e-5) * 0.006;
    float cycle = 0.1;
    float t1 = fract(time * cycle);
    float t2 = fract(time * cycle + 0.5);
    vec3 p1 = p - current * ((t1 - 0.5) / cycle);
    vec3 p2 = p - current * ((t2 - 0.5) / cycle);
    float blend = abs(t1 - 0.5) * 2.0;
    vec3 a = detailCells(p1 * 70.0);
    vec3 b = detailCells(p2 * 70.0);
    float seam = mix(1.0 - smoothstep(0.0, 0.07, a.y - a.x), 1.0 - smoothstep(0.0, 0.07, b.y - b.x), blend);
    float id = mix(a.z, b.z, blend);
    float proud = mix(smoothstep(0.0, 0.35, a.y - a.x), smoothstep(0.0, 0.35, b.y - b.x), blend);
    float ropes = mix(detailNoise(p1 * 900.0), detailNoise(p2 * 900.0), blend);
    float height = proud * (0.7 + 0.3 * id) + ropes * proud * 0.3;
    return vec3(seam, id, height);
  }
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
/** The noise, cells and relief functions alone, for a vertex shader: `detailBump` takes screen derivatives, which a vertex has not. */
const NOISE_VERTEX = NOISE.slice(0, NOISE.indexOf('vec3 detailBump')) + '\n'

/** Pass the planet-frame position (and any extra attribute) through to the fragment shader. */
export function passThrough(
  shader: THREE.WebGLProgramParametersWithUniforms,
  extra: { readonly attribute: string; readonly type: string } | undefined,
): void {
  const declare =
    extra === undefined
      ? ''
      : `attribute ${extra.type} ${extra.attribute};\nvarying ${extra.type} v_${extra.attribute};\n`
  const assign = extra === undefined ? '' : `\n  v_${extra.attribute} = ${extra.attribute};`
  shader.vertexShader =
    `uniform float detailTime;\nvarying vec3 vDetailPosition;\nvarying vec3 vDetailNormal;\n${declare}` +
    NOISE_VERTEX +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n  vDetailPosition = position;\n  vDetailNormal = normal;${assign}`,
    )
  const varying = extra === undefined ? '' : `varying ${extra.type} v_${extra.attribute};\n`
  shader.fragmentShader =
    `uniform float detailTime;\nuniform float detailRange;\nuniform sampler2D detailClouds;\nuniform float detailCloudSpin;\nuniform vec3 detailCloudSun;\nuniform mat3 detailNormalMatrix;\nuniform vec2 detailRings;\nuniform vec4 detailRingBands[16];\nuniform float detailAurora;\nuniform sampler2D detailCities;\nuniform float detailCityLight;\nuniform vec4 detailMoons[2];\nuniform vec4 cloudFlow;\nuniform vec2 cloudFlowLife;\nuniform float detailUnder;\nvarying vec3 vDetailPosition;\nvarying vec3 vDetailNormal;\n${varying}` +
    NOISE +
    FLOW_GLSL +
    CLOUD_SHADOW +
    RING_SHADOW +
    MOON_SHADOW +
    shader.fragmentShader
  shader.uniforms.detailTime = DETAIL_TIME
  shader.uniforms.detailRange = DETAIL_RANGE
  shader.uniforms.detailClouds = DETAIL_CLOUDS
  shader.uniforms.detailCloudSpin = DETAIL_CLOUD_SPIN
  shader.uniforms.detailCloudSun = DETAIL_CLOUD_SUN
  shader.uniforms.detailNormalMatrix = DETAIL_NORMAL_MATRIX
  shader.uniforms.detailRings = DETAIL_RINGS
  shader.uniforms.detailRingBands = DETAIL_RING_BANDS
  shader.uniforms.detailAurora = DETAIL_AURORA
  shader.uniforms.detailUnder = DETAIL_UNDER
  shader.uniforms.detailCities = DETAIL_CITIES
  shader.uniforms.detailCityLight = DETAIL_CITY_LIGHT
  shader.uniforms.detailMoons = DETAIL_MOONS
  shader.uniforms.cloudFlow = CLOUD_FLOW
  shader.uniforms.cloudFlowLife = CLOUD_FLOW_LIFE
  shader.uniforms.hazeSun = HAZE_SUN
  withMoonlight(shader)
}

/**
 * How much of the sun the rings take from a point: where the sun's ray
 * from it crosses the equatorial plane, how solid the rings are at that
 * radius. The rings lie in the planet's equator, so in any frame turned
 * about the axis they are the plane y = 0. Needs `detailRings` and
 * `detailRingBands` declared; the sun is passed in the point's own frame.
 */
export const RING_SHADOW = /* glsl */ `
  float ringShadowFrom(vec3 p, vec3 sun) {
    if (detailRings.y <= 0.0 || abs(sun.y) < 1e-4) return 0.0;
    float t = -p.y / sun.y;
    if (t <= 0.0) return 0.0;
    float r = length(p + sun * t);
    float across = (r - detailRings.x) / (detailRings.y - detailRings.x);
    if (across <= 0.0 || across >= 1.0) return 0.0;
    float at = across * 63.0;
    int i = int(floor(at));
    float f = fract(at);
    float a = 0.0;
    float b = 0.0;
    for (int k = 0; k < 16; k++) {
      vec4 v = detailRingBands[k];
      if (k * 4 == i) a = v.x;
      if (k * 4 == i + 1) b = v.x;
      if (k * 4 + 1 == i) a = v.y;
      if (k * 4 + 1 == i + 1) b = v.y;
      if (k * 4 + 2 == i) a = v.z;
      if (k * 4 + 2 == i + 1) b = v.z;
      if (k * 4 + 3 == i) a = v.w;
      if (k * 4 + 3 == i + 1) b = v.w;
    }
    return mix(a, b, f) * 0.85;
  }
`

const CLOUD_SHADOW = /* glsl */ `
  // How much cloud lies between this point and the sun: the cloud map read
  // where the sun's ray from here meets the layer, in the layer's own frame
  // (it turns a little faster than the ground). Soft, because the map is.
  float cloudTaps(vec2 uv) {
    vec2 o = vec2(0.0018, 0.0018);
    return texture2D(detailClouds, uv).r * 0.4
      + texture2D(detailClouds, uv + vec2(o.x, 0.0)).r * 0.15
      + texture2D(detailClouds, uv - vec2(o.x, 0.0)).r * 0.15
      + texture2D(detailClouds, uv + vec2(0.0, o.y)).r * 0.15
      + texture2D(detailClouds, uv - vec2(0.0, o.y)).r * 0.15;
  }
  float cloudShadow(vec3 p) {
    float up = max(0.15, dot(detailCloudSun, normalize(p)));
    vec3 d = normalize(p + detailCloudSun * (0.035 / up));
    float c = cos(detailCloudSpin);
    float s = sin(detailCloudSpin);
    d = vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
    vec2 uv = vec2(atan(d.z, -d.x) / 6.2831853 + 0.5, 1.0 - acos(clamp(d.y, -1.0, 1.0)) / 3.1415927);
    // Five taps and a soft threshold: the cloud map is a few hundred texels
    // round the whole planet, and read once its bilinear cells showed on
    // the sea as rows of dark blocks.
    // Read twice, as the winds carry the layer (winds.ts).
    float c0 = flowBlend(cloudTaps(flowUv(uv, 0)), cloudTaps(flowUv(uv, 1)));
    return smoothstep(0.15, 0.85, c0);
  }
`

/**
 * The level-of-detail blend: grid squares a patch has (x) and the screen
 * angle a grid square may cover before its patch splits (y), the two
 * numbers the quadtree decides with. From them the shader knows how far
 * away a patch gives way to its parent, and slides each vertex towards
 * where the parent draws it as that distance comes near — so the switch
 * itself changes nothing on screen.
 */
export const TERRAIN_MORPH = { value: new THREE.Vector2(32, 0.01) }

export const MORPH_DECLARE = /* glsl */ `
uniform vec2 terrainMorphLod;
attribute vec4 coarsePosition;
// How far a patch that has only just come in still looks like its parent,
// 1 to 0 (terrain.ts): on a phone a finer patch often lands late, while its
// coarse stand-in is on screen close up, and swapped in at once the ground
// and the shallows changed in one frame. It starts as the parent and slides.
attribute float arrival;
// 1 along an edge this patch shares with a coarser one: there it takes the
// coarser edge's shape exactly, so the two meet with no step for a skirt to
// show through (terrain.ts).
attribute float stitch;
attribute vec3 coarseNormal;
float terrainMorphAt(vec3 local) {
  float level = coarsePosition.w;
  if (level < 0.5) return 0.0;
  // The parent splits once its nearest point is this close (see lod.ts).
  float parentSpan = 1.5707963 / exp2(level - 1.0);
  float splits = parentSpan / terrainMorphLod.x / terrainMorphLod.y;
  float away = distance((modelMatrix * vec4(local, 1.0)).xyz, cameraPosition);
  return max(max(smoothstep(0.5 * splits, 0.85 * splits, away), arrival), stitch);
}
`

/** Blend a ground or shadow shader's position (and normal) towards the coarse patch. */
export function withTerrainMorph(
  shader: THREE.WebGLProgramParametersWithUniforms,
  normals: boolean,
): void {
  shader.uniforms.terrainMorphLod = TERRAIN_MORPH
  let vertex = (MORPH_DECLARE + shader.vertexShader).replace(
    'void main() {',
    'void main() {\n  float terrainMorph = terrainMorphAt(position);',
  )
  if (normals) {
    vertex = vertex.replace(
      '#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\n  objectNormal = normalize(mix(objectNormal, coarseNormal, terrainMorph));',
    )
  }
  shader.vertexShader = vertex.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  transformed = mix(transformed, coarsePosition.xyz, terrainMorph);',
  )
}

/** The ground's shadow caster, morphed the same way, so a patch's shadow is cast by the ground drawn. */
export function terrainDepthMaterial(): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  material.onBeforeCompile = (shader) => {
    withTerrainMorph(shader, false)
  }
  material.customProgramCacheKey = () => 'planet-ground-depth'
  return material
}
