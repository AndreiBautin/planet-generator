import * as THREE from 'three'

import { HAZE_SUN } from './haze'
import type { GroundKind } from './ground-atlas'
import type { GroundTextures } from './textures'
import { DETAIL_MOONS, MOON_SHADOW } from './eclipse'
import { withValleyFog } from './valley-fog'
import { DETAIL_SEASON, LEAF_SEASON_GLSL } from './leaves'
import { SEA_RADIUS } from './water'
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

/** Pass the planet-frame position (and any extra attribute) through to the fragment shader. */
function passThrough(
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

const MORPH_DECLARE = /* glsl */ `
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
function withTerrainMorph(
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

/**
 * The ground: grain and bumps, and the pattern of whatever the ground is.
 * On a molten world the lowland runs with channels of lava that glow.
 */
export function withGroundDetail(
  material: THREE.MeshStandardMaterial,
  textures: GroundTextures,
  molten = false,
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    passThrough(shader, { attribute: 'pattern', type: 'vec4' })
    withTerrainMorph(shader, true)
    // The colour, the pattern and the detail's own frame slide with the
    // shape: a vertex drawn where the parent puts it, painted as the parent
    // paints it.
    shader.vertexShader =
      'attribute vec3 coarseColour;\nattribute vec4 coarsePattern;\nattribute vec4 ground;\nattribute vec4 coarseGround;\nattribute float reef;\nattribute float farm;\nvarying vec4 v_ground;\nvarying float v_reef;\nvarying float v_farm;\n' +
      shader.vertexShader
        .replace(
          '#include <color_vertex>',
          /* glsl */ `#include <color_vertex>
  #ifdef USE_COLOR
  vColor.rgb = mix(vColor.rgb, coarseColour, terrainMorph);
  #endif`,
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `vDetailPosition = transformed;
  vDetailNormal = objectNormal;
  v_pattern = mix(pattern, coarsePattern, terrainMorph);
  v_ground = mix(ground, coarseGround, terrainMorph);
  v_reef = reef;
  v_farm = farm;
#include <project_vertex>`,
        )
    // Only the photographs this kind of world uses: a phone allows about
    // sixteen textures to a shader, and every kind at once is twenty-two.
    // The biome grounds on land bring colour and grain; the relief comes
    // from the main photographs' normal maps.
    const layers: readonly GroundKind[] = molten
      ? ['basalt', 'ash']
      : ['grass', 'sand', 'stone', 'snow', 'needles', 'savanna', 'tundra', 'salt']
    const flat: ReadonlySet<GroundKind> = new Set(['needles', 'savanna', 'tundra', 'salt'])
    let declare = 'varying vec4 v_ground;\nvarying float v_reef;\nvarying float v_farm;\n'
    for (const kind of layers) {
      const name = kind.charAt(0).toUpperCase() + kind.slice(1)
      // The same uniform objects for every material, so a photograph that
      // arrives later reaches every planet's ground at once.
      shader.uniforms[`ground${name}`] = textures[kind].color
      shader.uniforms[`ground${name}Mean`] = textures[kind].mean
      declare += `uniform sampler2D ground${name};\nuniform float ground${name}Mean;\n`
      if (!flat.has(kind)) {
        shader.uniforms[`ground${name}Normal`] = textures[kind].normal
        declare += `uniform sampler2D ground${name}Normal;\n`
      }
    }
    shader.uniforms.detailSeason = DETAIL_SEASON
    shader.fragmentShader =
      declare +
      LEAF_SEASON_GLSL +
      /* glsl */ `
      // A texture laid on from three sides and blended by which way the
      // ground faces, so a sphere carries it with no stretching anywhere.
      vec4 groundTri(sampler2D tex, vec3 p, vec3 w) {
        vec4 c = vec4(0.0);
        if (w.x > 0.02) c += texture2D(tex, p.yz) * w.x;
        if (w.y > 0.02) c += texture2D(tex, p.xz) * w.y;
        if (w.z > 0.02) c += texture2D(tex, p.xy) * w.z;
        return c;
      }
      // A normal map laid on the same way: each side's tangent-space tilt
      // turned into a tilt along that side's own axes in the planet's frame.
      vec3 groundTriNormal(sampler2D tex, vec3 p, vec3 w) {
        vec3 d = vec3(0.0);
        if (w.x > 0.02) { vec2 s = texture2D(tex, p.yz).xy * 2.0 - 1.0; d += vec3(0.0, s.x, s.y) * w.x; }
        if (w.y > 0.02) { vec2 s = texture2D(tex, p.xz).xy * 2.0 - 1.0; d += vec3(s.x, 0.0, s.y) * w.y; }
        if (w.z > 0.02) { vec2 s = texture2D(tex, p.xy).xy * 2.0 - 1.0; d += vec3(s.x, s.y, 0.0) * w.z; }
        return d;
      }
      // One kind of ground's share: its colour levelled to the brightness
      // it was cut at and part-desaturated, so the biome's own colour is
      // what the eye reads and the photograph gives it grain and shadow.
      void groundLayer(
        sampler2D colorMap, sampler2D normalMap, float mean, float share,
        vec3 p, vec3 q, vec3 w, inout vec3 albedo, inout float relief, inout vec3 tilt
      ) {
        if (share < 0.02) return;
        vec4 near = groundTri(colorMap, p, w);
        vec4 broad = groundTri(colorMap, q, w);
        vec3 c = (near.rgb * 0.65 + broad.rgb * 0.35) / (mean * 2.0);
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        albedo += mix(vec3(lum), c, 0.35) * share;
        relief += (near.a * 0.65 + broad.a * 0.35) * share;
        if (share > 0.2) tilt += (groundTriNormal(normalMap, p, w) * 0.7 + groundTriNormal(normalMap, q, w) * 0.3) * share;
      }
      // A ground with no normal map of its own: colour and grain only.
      void groundFlat(
        sampler2D colorMap, float mean, float share,
        vec3 p, vec3 q, vec3 w, inout vec3 albedo, inout float relief
      ) {
        if (share < 0.02) return;
        vec4 near = groundTri(colorMap, p, w);
        vec4 broad = groundTri(colorMap, q, w);
        vec3 c = (near.rgb * 0.65 + broad.rgb * 0.35) / (mean * 2.0);
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        albedo += mix(vec3(lum), c, 0.35) * share;
        relief += (near.a * 0.65 + broad.a * 0.35) * share;
      }
      ` +
      shader.fragmentShader
    if (molten) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // Rivers of lava threading the low ground: the zero line of a
          // noise, which is a network of winding channels, lit from within
          // and pulsing slowly; and pools where it has spread.
          // The molten sea lights the ground beside it from below: shores
          // and low ground glow, more the nearer the lava, which is what
          // keeps a coast a shape on a night side lit by nothing else.
          float overLava = max(length(vDetailPosition) - 1.0015, 0.0);
          float spill = exp(-overLava / 0.0009);
          totalEmissiveRadiance += (diffuseColor.rgb * 0.35 + 0.012) * vec3(1.0, 0.33, 0.07) * spill;
          float lava = v_pattern.y;
          if (lava > 0.02) {
            float lavaFar = 1.0 - smoothstep(0.2, 1.2, length(vViewPosition));
            vec3 p = vDetailPosition * 160.0;
            float n = detailNoise(p) + detailNoise(p * 2.7) * 0.35 - 0.675;
            float channel = 1.0 - smoothstep(0.0, 0.035 + 0.03 * (1.0 - lavaFar), abs(n));
            // A pool crusts over, as the sea does: dark plates and the
            // glow showing in the cracks between them. One flat glowing
            // sheet across a low slope read as a pale lit hillside at night.
            float crack = 1.0 - smoothstep(0.0, 0.05 + 0.08 * (1.0 - lavaFar), abs(detailNoise(vDetailPosition * 420.0) - 0.5));
            float pool = smoothstep(0.58, 0.75, detailNoise(vDetailPosition * 45.0)) * lava * (0.18 + 0.82 * crack);
            // Lava running down the channel: a fine noise carried along it.
            float run = detailNoise(vDetailPosition * 700.0 - vec3(detailTime * 2.5, detailTime * 1.7, -detailTime * 2.1) * 0.0012 * 700.0);
            float glow = max(channel * lava * (0.7 + run * 0.6), pool) * (0.8 + 0.2 * sin(detailTime * 0.9 + n * 20.0));
            totalEmissiveRadiance += vec3(1.0, 0.32, 0.04) * glow * 1.6;
            diffuseColor.rgb *= 1.0 - glow * 0.6;
          }
        }`,
      )
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float detailDistance = length(vViewPosition);
        // Two scales of grain: one seen from a low glide, one only right
        // above the ground.
        float detailNear = 1.0 - smoothstep(0.03, 0.4, detailDistance);
        float detailClose = 1.0 - smoothstep(0.008, 0.07, detailDistance);
        float patternFar = 1.0 - smoothstep(0.12, 0.7, detailDistance);
        float bumpSpan = length(fwidth(vDetailPosition));
        // Relief comes from the photographs' own normal maps; a procedural
        // bump that came in only near the eye was one more thing appearing.
        float detailHeight = 0.0;
        float detailShade = 1.0;
        float detailRough = 1.0;
        vec3 detailTilt = vec3(0.0);
        float stand = 1.0 - smoothstep(detailRange * 0.55, detailRange, detailDistance);

        // The ground's texture: which kinds of ground are here, blended,
        // laid on triplanar at two scales so neither the repeat nor the
        // texel shows, and faded where it would only shimmer.
        {
          float texFade = 1.0 - smoothstep(0.12, 0.8, detailDistance);
          if (texFade > 0.01) {
            vec3 n = normalize(vDetailPosition);
            vec3 w = pow(abs(n), vec3(6.0));
            w /= w.x + w.y + w.z;
            vec3 p = vDetailPosition * 1500.0;
            vec3 q = vDetailPosition * 260.0 + 17.3;
            vec3 albedo = vec3(0.0);
            float relief = 0.0;
            ${
              molten
                ? /* glsl */ `
            float wAsh = v_ground.w;
            float total = 1.0;
            groundLayer(groundBasalt, groundBasaltNormal, groundBasaltMean, 1.0 - wAsh, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundAsh, groundAshNormal, groundAshMean, wAsh, p, q, w, albedo, relief, detailTilt);`
                : /* glsl */ `
            float wSand = v_pattern.y;
            float wSnow = v_pattern.z;
            float wStone = v_pattern.w;
            // The biome grounds take their share from the grass and sand
            // they stand in for: savanna and tundra are grassland of a kind,
            // a salt flat is a desert floor, needles lie under conifers.
            float wNeedles = v_ground.x;
            float wSavanna = v_ground.y;
            float wTundra = v_ground.z;
            float wSalt = v_ground.w * (1.0 - wSnow);
            float wGrass = max(0.0, 1.0 - (wSand + wSnow + wStone + wNeedles + wSavanna + wTundra));
            wSand *= 1.0 - wSalt;
            float total = max(0.001, wSand + wSnow + wStone + wGrass + wNeedles + wSavanna + wTundra + wSalt);
            groundLayer(groundGrass, groundGrassNormal, groundGrassMean, wGrass, p, q, w, albedo, relief, detailTilt);
            groundFlat(groundNeedles, groundNeedlesMean, wNeedles, p, q, w, albedo, relief);
            groundFlat(groundSavanna, groundSavannaMean, wSavanna, p, q, w, albedo, relief);
            groundFlat(groundTundra, groundTundraMean, wTundra, p, q, w, albedo, relief);
            groundFlat(groundSalt, groundSaltMean, wSalt, p, q, w, albedo, relief);
            groundLayer(groundSand, groundSandNormal, groundSandMean, wSand, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundSnow, groundSnowNormal, groundSnowMean, wSnow, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundStone, groundStoneNormal, groundStoneMean, wStone, p, q, w, albedo, relief, detailTilt);`
            }
            albedo /= total;
            relief /= total;
            detailTilt *= texFade / total;
            diffuseColor.rgb *= mix(vec3(1.0), albedo * 2.0, texFade);
            detailHeight += (relief - 0.5) * 1.2 * texFade;
            // The high points of a surface are worn smoother than its
            // hollows, and snow has a sheen stone has not.
            float sheen = ${molten ? '0.0' : 'v_pattern.z'};
            detailRough = mix(1.0, (1.12 - relief * 0.3) * (1.0 - sheen * 0.35), texFade);
          }
        }

        // Meadow: open grass is never one green. Drier, yellower stretches
        // and lusher, darker hollows drift across it at two scales, so a
        // hillside reads as ground rather than as paint. Only green ground
        // takes it, and it fades out from orbit where it would be mottle.
        ${
          molten
            ? ''
            : /* glsl */ `{
          vec3 base = diffuseColor.rgb;
          float greenness = clamp((base.g - base.b) * 3.0, 0.0, 1.0) * (1.0 - smoothstep(1.0, 1.15, base.r / max(base.g, 0.001)));
          float grassy = max(0.0, 1.0 - (v_pattern.x + v_pattern.y + v_pattern.z + v_pattern.w));
          float meadow = greenness * grassy * (1.0 - smoothstep(0.6, 2.0, detailDistance));
          if (meadow > 0.02) {
            float fineFilter = 1.0 - smoothstep(0.2, 0.5, length(fwidth(vDetailPosition)) * 240.0);
            float drift = detailNoise(vDetailPosition * 55.0) * 0.7 + (detailNoise(vDetailPosition * 240.0 + 5.1) - 0.5) * 0.3 * fineFilter + 0.15;
            float dry = smoothstep(0.48, 0.72, drift);
            float lush = 1.0 - smoothstep(0.28, 0.5, drift);
            vec3 tint = mix(vec3(1.0), vec3(1.22, 1.02, 0.5), dry * 0.75);
            tint = mix(tint, vec3(0.55, 0.78, 0.62), lush * 0.75);
            diffuseColor.rgb *= mix(vec3(1.0), tint, meadow);
          }
        }`
        }

        // Canopy: a forest from above is crowns with dark gaps, no two
        // crowns the same shade, in groves of lighter and darker wood —
        // beyond where the trees themselves stand. Within that range the
        // ground is the forest floor: dark, leaf-littered, mottled.
        // A pattern finer than a pixel aliases into crawling static as the
        // eye moves: each fades out once its cells shrink below a few
        // pixels, by the screen-space rate the position changes.
        float pixelSpan = length(fwidth(vDetailPosition));
        // Where trees stand, the floor between them is dark at every
        // distance. It used to share the crowns' filter and went bright past
        // a short range, so a forest became dark trees on pale ground — the
        // most contrast there is, and in motion it broke into speckle.
        // The canopy weight runs about a third to a half across a wood (it
        // is the grove field, soft-edged), so it is sharpened here: any real
        // wood takes the full floor.
        float woods = smoothstep(0.05, 0.3, v_pattern.x) * patternFar;
        if (woods * stand > 0.02) {
          float litterFilter = 1.0 - smoothstep(0.15, 0.45, pixelSpan * 1800.0);
          float litter = mix(0.5, detailNoise(vDetailPosition * 1800.0), litterFilter) * 0.5 + 0.5;
          float floorTone = 0.38 + litter * 0.22;
          detailShade *= mix(1.0, floorTone, woods * stand);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 0.84, 0.6), stand * woods * 0.6);
        }
        // Past where the trees stand, a wood is painted as what a wood looks
        // like from there: a dark, cool mass, mottled softly, with no cells.
        // It was drawn as crowns — pale cells with dark gaps — which read as
        // a honeycomb on the ground until the trees appeared on top of it.
        // Its tone matches the floor and the trees, so they arrive into a
        // wood already there rather than onto a pattern.
        // The tone holds at every distance, so a wood is on the globe from
        // orbit and the same wood up close; only its texture — crowns at
        // two scales, each filtered away before it could shimmer — comes in
        // as the eye nears, and the crowns' relief lights it as a surface.
        // Clumps of crowns at two scales, each filtered away before it could
        // shimmer: rounded by taking the upper part of a noise, so a wood is
        // a mass of lit tops over shadowed gaps and never a tiling.
        float clumpA = mix(0.5, detailNoise(vDetailPosition * 1100.0), 1.0 - smoothstep(0.15, 0.5, pixelSpan * 1100.0));
        float clumpB = mix(0.5, detailNoise(vDetailPosition * 2600.0), 1.0 - smoothstep(0.15, 0.5, pixelSpan * 2600.0));
        float crown = smoothstep(0.3, 0.8, clumpA * 0.65 + clumpB * 0.35);
        float broad = detailNoise(vDetailPosition * 220.0);
        // The edge of a wood is ragged at clump scale, not the smooth line
        // of the grove field it grows from.
        float edge = v_pattern.x + (clumpA - 0.5) * 0.2 + (broad - 0.5) * 0.1;
        // From high up a patch's vertices are far apart, and each one's wood
        // weight spreads over the fan of triangles round it as a hexagon: a
        // threshold on that drew every wood as a tile, and the land from
        // orbit as a patchwork of them. Far off the weight darkens the land
        // by itself, no threshold, so a wood is a soft shading that follows
        // the ground rather than a mosaic laid over it.
        float far = smoothstep(0.0006, 0.004, pixelSpan);
        float canopy = mix(smoothstep(0.08, 0.26, edge), clamp(v_pattern.x * 1.6, 0.0, 0.85), far) * (1.0 - stand);
        if (canopy > 0.02) {
          float tone = (0.34 + broad * 0.2) * (0.7 + crown * 0.55);
          detailShade *= mix(1.0, tone, canopy);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.95, 0.78), canopy);
          // The broadleaf part of a wood through the year (leaves.ts), as
          // the trees standing on it are: the conifers keep their green.
          vec3 leafAt = leafSeason(normalize(vDetailPosition), broad);
          float broadleaves = (1.0 - v_ground.x * 0.75) * canopy;
          diffuseColor.rgb = mix(diffuseColor.rgb, leafColour(diffuseColor.rgb, leafAt, broad) * 0.55, broadleaves * (leafAt.x + leafAt.y + leafAt.z));
          detailHeight += (crown - 0.5) * 2.0 * canopy;
          detailRough = mix(detailRough, 0.95, canopy);
        }

        // Dunes on open sand: long crests laid across one wind, wandering
        // a little, each a gentle slope up and a steep, shadowed lee face
        // down. Faded out by how much ground a pixel spans, never by
        // distance — the hand-drawn ripples below were cut off at a range
        // and appeared ahead of the eye — so from orbit a sand sea is plain.
        {
          float sandy = v_pattern.y * (1.0 - v_pattern.z) * (1.0 - v_pattern.x);
          float duneSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 1000.0);
          if (sandy * duneSeen > 0.03) {
            float warp = detailNoise(vDetailPosition * 90.0) * 2.2;
            float crest = dot(vDetailPosition * 650.0, vec3(0.8, 0.15, 0.58)) + warp;
            float phase = fract(crest);
            float profile = phase < 0.78 ? phase / 0.78 : (1.0 - phase) / 0.22;
            float lee = smoothstep(0.74, 0.82, phase) * (1.0 - smoothstep(0.97, 1.0, phase));
            float weight = sandy * duneSeen;
            detailHeight += (profile - 0.5) * 1.4 * weight;
            detailShade *= mix(1.0, mix(1.05, 0.7, lee), weight);
          }
        }

        // No sand ripples, snow ridges or stone cracks drawn by hand here.
        // Each was drawn only within a certain distance, so each appeared
        // ahead of the eye as it flew — and the cracks, on a world that is
        // mostly stone, read as a honeycomb over the whole ground. The
        // photographs above carry the grain, and the GPU filters them
        // smoothly at every distance, so nothing of theirs pops.

        // A town's fields (patch-data.ts, farm): plots on a grid laid along
        // the ground, each its own crop — ripe wheat, green, ploughed earth —
        // with a darker hedge round it. Faded to the crops' average colour
        // once a pixel spans a plot, so from orbit a town sits in a soft
        // ring of farmland rather than a sparkle.
        if (v_farm > 0.01) {
          // Laid on the two axes the ground faces least along, as a cube's
          // face would be: a frame of the point's own is square to the
          // point, and every point read the same plot.
          vec3 fieldFacing = abs(normalize(vDetailPosition));
          vec2 fieldAt = (fieldFacing.x > fieldFacing.y && fieldFacing.x > fieldFacing.z
            ? vDetailPosition.yz
            : (fieldFacing.y > fieldFacing.z ? vDetailPosition.xz : vDetailPosition.xy)) * 650.0;
          // Not turned by a noise: turning varied across a single plot and
          // drew the hedges as wavy streaks.
          vec2 plot = floor(fieldAt * vec2(1.0, 1.6));
          vec2 inPlot = fract(fieldAt * vec2(1.0, 1.6));
          float pick = fract(sin(dot(plot, vec2(12.9898, 78.233))) * 43758.5453);
          vec3 crop = pick < 0.35 ? vec3(0.78, 0.66, 0.3) : (pick < 0.7 ? vec3(0.42, 0.58, 0.22) : vec3(0.42, 0.31, 0.2));
          float hedge = smoothstep(0.0, 0.07, min(min(inPlot.x, 1.0 - inPlot.x), min(inPlot.y, 1.0 - inPlot.y)));
          vec3 fields = crop * (0.62 + 0.38 * hedge);
          float plotSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 1040.0);
          fields = mix(vec3(0.5, 0.5, 0.25), fields, plotSeen);
          diffuseColor.rgb = mix(diffuseColor.rgb, fields, v_farm * 0.85);
        }

        // Coral on a warm, shallow sea bed (patch-data.ts, reef): clumps
        // of it in a few colours, lumpy, with the plain bed between —
        // seen through the shallows from above, and close to on a dive.
        if (v_reef > 0.01) {
          vec3 rp = vDetailPosition * 1800.0;
          float clump = detailNoise(rp * 0.35);
          float lumps = detailNoise(rp * 1.6);
          float hue = detailNoise(rp * 0.12 + 17.0);
          vec3 coral = mix(
            mix(vec3(0.9, 0.32, 0.3), vec3(0.95, 0.6, 0.22), smoothstep(0.3, 0.6, hue)),
            vec3(0.55, 0.3, 0.8),
            smoothstep(0.62, 0.85, hue));
          // From above, only the shallows' coral: reefs run deeper now so a
          // dive can find them, and seen down through that much water they
          // blotched the warm seas pink. From below, all of it.
          float reefDepth = ${SEA_RADIUS.toFixed(5)} - length(vDetailPosition);
          float reefSeen = v_reef * mix(1.0 - smoothstep(0.0018, 0.006, reefDepth), 1.0, detailUnder);
          float body = smoothstep(0.5, 0.66, clump) * reefSeen;
          // Each noise faded to its average once a pixel spans its grain, as
          // the canopy's are: read raw from orbit the clumps and lumps were
          // finer than a pixel, and every warm coast sparkled as it turned.
          float clumpSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 630.0);
          float lumpSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 2880.0);
          float hueSeen = 1.0 - smoothstep(0.15, 0.5, pixelSpan * 216.0);
          coral = mix(vec3(0.8, 0.42, 0.38), coral, hueSeen);
          body = mix(reefSeen * 0.3, body, clumpSeen);
          lumps = mix(0.5, lumps, lumpSeen);
          diffuseColor.rgb = mix(diffuseColor.rgb, coral * (0.7 + 0.5 * lumps), body);
          detailHeight += (lumps - 0.5) * 2.0 * body;
        }

        diffuseColor.rgb *= detailShade * (1.0 + detailHeight * 0.3);
        diffuseColor.rgb *= 1.0 - cloudShadow(vDetailPosition) * 0.55;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * detailRough, 0.3, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        // The photographs' own relief first, tilted in the planet's frame
        // and brought into view space; the procedural bumps on top.
        if (dot(detailTilt, detailTilt) > 0.0) {
          vec3 tilted = normalize(normalize(vDetailNormal) + detailTilt * 0.55);
          normal = normalize(detailNormalMatrix * tilted) * faceDirection;
        }
        normal = detailBump(
          -vViewPosition,
          normal,
          vec2(dFdx(detailHeight), dFdy(detailHeight)) * 0.9,
          faceDirection);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // The planet shadows its own ground: once the sun is under the
        // horizon it lights nothing there, however a slope faces. Without
        // it, every hillside turned towards a sun already set glowed red
        // across the dark, the evening's light on the wrong side of night.
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 groundUp = normalize(detailNormalMatrix * normalize(vDetailPosition));
          float groundDay = smoothstep(-0.05, 0.08, dot(groundUp, directionalLights[0].direction));
          // And the rings, if any, cast their bands across it.
          groundDay *= 1.0 - ringShadowFrom(vDetailPosition, detailCloudSun);
          // And a moon, passing before the sun, its shadow (eclipse.ts).
          groundDay *= 1.0 - moonShadowFrom(vDetailPosition, detailCloudSun);
          reflectedLight.directDiffuse *= groundDay;
          reflectedLight.directSpecular *= groundDay;
          // Seen from under the sea, the sun through the moving surface
          // draws a net of light on the sea bed: two drifting fields, bright
          // where they agree, and fainter the deeper the floor.
          if (detailUnder > 0.0) {
            float seaFloor = ${SEA_RADIUS.toFixed(5)} - length(vDetailPosition);
            if (seaFloor > 0.0) {
              vec3 cp = vDetailPosition * 1400.0;
              float ca = detailNoise(cp + vec3(detailTime * 0.35, 0.0, detailTime * 0.2));
              float cb = detailNoise(cp * 1.31 - vec3(detailTime * 0.25, detailTime * 0.3, 0.0));
              float net = pow(1.0 - abs(ca - cb), 14.0);
              float reach = exp(-seaFloor / 0.012);
              reflectedLight.directDiffuse *= 1.0 + net * 2.4 * reach * detailUnder;
            }
          }
          // Under the aurora's band, on the night side, the ground takes a
          // little of its green: snow most, being brightest.
          // The towns' glow on the ground round them, at night: what makes
          // a town a place from a glide, where its lights alone are a few
          // sparks. Off by day, on through the dusk.
          if (detailCityLight > 0.0) {
            vec3 cityUp = normalize(vDetailPosition);
            vec2 cityUv = vec2(atan(cityUp.z, -cityUp.x) / 6.2831853 + 0.5, 1.0 - acos(clamp(cityUp.y, -1.0, 1.0)) / 3.1415927);
            float cityDark = 1.0 - smoothstep(-0.12, 0.04, dot(cityUp, detailCloudSun));
            float town = texture2D(detailCities, cityUv).r;
            // Light on the ground's own colour, as it falls on the houses and
            // trees (town-glow.ts): emitted as a flat orange of its own, the
            // sand round a village shone beige while the village stood black.
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.3) * town * town * town * cityDark * detailCityLight * 0.7;
          }
          if (detailAurora > 0.0) {
            vec3 up = normalize(vDetailPosition);
            float band = exp(-pow((acos(abs(up.y)) - 0.37) / 0.13, 2.0));
            float dark = 1.0 - smoothstep(-0.25, 0.02, dot(up, detailCloudSun));
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.12, 0.85, 0.42) * band * dark * detailAurora;
          }
        }
        #endif`,
      )
    withValleyFog(shader, 'mistTop')
  }
  material.customProgramCacheKey = () =>
    molten ? 'planet-lava-ground-detail' : 'planet-ground-detail'
  return material
}

/**
 * The sea: waves that lift and push the surface itself near the camera —
 * four trains of Gerstner waves crossing, their crests sharpened and
 * leaning, taller as they run into the shallows — with their own normals,
 * foam where a crest is steep enough to break and along the coast, fine
 * ripples over it all, and lighter water over the shallows.
 */
export function withWaterDetail(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    passThrough(shader, { attribute: 'depth', type: 'float' })
    // The depth under the sea slides between levels as the ground does, so
    // the shallows and the foam do not jump when a finer patch comes in.
    shader.uniforms.terrainMorphLod = TERRAIN_MORPH
    shader.vertexShader = (
      MORPH_DECLARE +
      'attribute float coarseDepth;\nattribute vec2 ice;\nattribute float inland;\nattribute float rapids;\nattribute vec3 current;\nvarying float v_ice;\nvarying float v_inland;\nvarying float v_rapids;\nvarying vec3 v_current;\nvarying vec3 v_up;\n' +
      shader.vertexShader
    )
      .replace(
        'void main() {',
        'void main() {\n  float seaMorph = terrainMorphAt(position);\n  float seaDepth = mix(depth, coarseDepth, seaMorph);\n  v_ice = mix(ice.x, ice.y, seaMorph);\n  v_inland = inland;\n  v_rapids = rapids;\n  v_current = current;\n  v_up = normalize(normalMatrix * normalize(position));',
      )
      .replace('v_depth = depth;', 'v_depth = seaDepth;')
      .replace('smoothstep(0.0, 0.0004, depth)', 'smoothstep(0.0, 0.0004, seaDepth)')
      .replace('smoothstep(0.0, 0.004, depth)', 'smoothstep(0.0, 0.004, seaDepth)')
    shader.vertexShader =
      'varying float v_jac;\nvarying float v_heave;\n' +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
        vec3 waveOffset = vec3(0.0);
        {
          vec3 up = normalize(position);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(up, east);
          // Faded with distance so coarse far patches, which could not follow
          // a wave, are not torn from fine near ones; held still right at the
          // shore, where the land's edge is; taller running into the shallows.
          float seaView = length((modelViewMatrix * vec4(position, 1.0)).xyz);
          // And calm under ice, which damps the sea: waves lifted the water
          // over the floes as the eye came down, and the ice drowned.
          // And none on a lake or river: a swell needs a sea's fetch.
          float lift = (1.0 - smoothstep(0.02, 0.14, seaView)) * smoothstep(0.0, 0.0004, seaDepth) * (1.0 - smoothstep(0.05, 0.4, v_ice)) * (1.0 - inland);
          float shoal = 1.0 + 0.7 * (1.0 - smoothstep(0.0, 0.004, depth));
          // (direction, wavelength, steepness, period) for four trains.
          vec4 trainA = vec4(0.3, 0.02, 0.16, 11.0);
          vec4 trainB = vec4(1.9, 0.0105, 0.2, 7.5);
          vec4 trainC = vec4(-0.8, 0.0055, 0.22, 5.2);
          vec4 trainD = vec4(2.6, 0.0028, 0.25, 3.6);
          vec4 trains[4];
          trains[0] = trainA; trains[1] = trainB; trains[2] = trainC; trains[3] = trainD;
          float nx = 0.0;
          float nz = 0.0;
          float ny = 1.0;
          float heave = 0.0;
          float span = 0.0;
          for (int i = 0; i < 4; i++) {
            vec4 w = trains[i];
            vec3 d = cos(w.x) * east + sin(w.x) * north;
            float k = 6.2831853 / w.y;
            float A = (w.z / k) * shoal * lift;
            float phi = k * dot(position, d) - (6.2831853 / w.w) * detailTime;
            float c = cos(phi);
            float s = sin(phi);
            waveOffset += d * (0.8 * A * c) + up * (A * s);
            nx -= cos(w.x) * k * A * c;
            nz -= sin(w.x) * k * A * c;
            ny -= 0.8 * k * A * s;
            heave += A * s;
            span += A;
          }
          objectNormal = normalize(east * nx + up * ny + north * nz);
          // Where the surface is squeezed the crest is breaking.
          v_jac = ny;
          v_heave = span > 0.0 ? heave / span : 0.0;
        }`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
        // Past the shores the sheet is held just under the dry ground
        // (patch-data.ts). There it slides to the parent patch with the
        // ground, keeping the same depth under it: left where it was, the
        // ground sinking towards its parent's shape uncovered it, and from
        // orbit every rough slope was speckled with water and ice.
        if (depth <= 0.0) {
          float coarseLength = max(length(coarsePosition.xyz), 1e-6);
          vec3 coarseSheet = coarsePosition.xyz * ((coarseLength + depth) / coarseLength);
          transformed = mix(transformed, coarseSheet, seaMorph);
        }
        transformed += waveOffset;`,
        )
    shader.uniforms.seaSky = DETAIL_SKY
    shader.uniforms.seaZenith = DETAIL_ZENITH
    const seaIce: unknown = material.userData.seaIce
    shader.uniforms.seaIce = {
      value: seaIce instanceof THREE.Color ? seaIce : new THREE.Color(0.9, 0.94, 0.97),
    }
    shader.fragmentShader =
      'uniform vec3 seaSky;\nuniform vec3 seaZenith;\nuniform vec3 seaIce;\nvarying vec3 v_up;\nvarying float v_ice;\nvarying float v_inland;\nvarying float v_rapids;\nvarying vec3 v_current;\nvarying float v_jac;\nvarying float v_heave;\n' +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float seaDistance = length(vViewPosition);
        float seaNear = 1.0 - smoothstep(0.015, 0.12, seaDistance);
        vec3 drift = vec3(detailTime * 0.9, detailTime * 0.6, -detailTime * 0.7) * 0.001;
        // Lighter over the shallows, where the floor shows through, and
        // lighter on a crest than in a trough.
        float shallows = 1.0 - smoothstep(0.0, 0.004, v_depth);
        // A river is a few ten-thousandths deep everywhere, which by the
        // sea's measure is all shallows and all surf: inland water is read
        // by its own depth, greener and darker, and its edge is not foam.
        float inlandShallows = 1.0 - smoothstep(0.0, 0.0003, v_depth);
        shallows = mix(shallows, inlandShallows * 0.5, v_inland);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.75, 0.7), v_inland * 0.6);
        // Turquoise where the floor shows through, the sea's own colour
        // over the shelf, darkening to ink over the deep: read by the true
        // depth, so a reef or a sandbank shows as a paler patch out at sea.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 2.0, 1.75), shallows * 0.5);
        // And a band of clear turquoise along the beach itself, where the
        // sand shows through a few hand-spans of water.
        float lagoon = (1.0 - smoothstep(0.0, 0.0016, v_depth)) * (1.0 - v_inland) * (1.0 - smoothstep(0.4, 0.9, v_ice));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.62, 0.58), lagoon * 0.55);
        float abyss = smoothstep(0.004, 0.025, v_depth) * (1.0 - v_inland);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.62, 0.85), abyss);
        diffuseColor.rgb *= 1.0 + v_heave * 0.18;
        // The wash at the water's edge: a band of foam that runs up the
        // beach and draws back, its edge broken by the churn.
        float calm = (1.0 - v_inland) * (1.0 - smoothstep(0.4, 0.9, v_ice));
        float churn = detailNoise(vDetailPosition * 1500.0 + drift * 1500.0);
        float reach = 0.00035 + 0.00022 * sin(detailTime * 0.7 + churn * 1.5);
        float wash = 1.0 - smoothstep(reach * 0.5, reach, v_depth);
        float foam = wash * smoothstep(0.3, 0.65, churn + wash * 0.3) * calm * (1.0 - smoothstep(0.3, 1.2, seaDistance));
        // Lines of surf a little way out, parallel to the shore and running
        // in to it: the same depth everywhere along a line, so they follow
        // the coast's shape. Each a sharp breaking front with foam trailing
        // behind it on the seaward side, broken by the churn so no line is
        // unbroken, and seen from a glide rather than only from the beach.
        float surfZone = smoothstep(0.0002, 0.0006, v_depth) * (1.0 - smoothstep(0.0012, 0.0034, v_depth)) * calm;
        float set = fract(v_depth * 1250.0 + detailTime * 0.22);
        float front = smoothstep(0.86, 0.97, set) * (1.0 - smoothstep(0.97, 1.0, set));
        float trail = smoothstep(0.55, 0.97, set) * 0.45;
        float broken = smoothstep(0.25, 0.6, churn);
        foam = max(foam, surfZone * max(front, trail * broken) * broken * (1.0 - smoothstep(0.35, 1.4, seaDistance)));
        // Breaking crests: where the wave has squeezed the surface most,
        // streaked by a noise so the foam is ragged, and the odd cap at sea.
        float breaking = smoothstep(0.62, 0.42, v_jac);
        float streak = smoothstep(0.35, 0.75, detailNoise(vDetailPosition * 1800.0 + drift * 1200.0));
        float caps = (1.0 - v_inland) * max(breaking * (0.4 + streak * 0.6), smoothstep(0.9, 0.98, detailNoise(vDetailPosition * 1100.0 - drift * 1100.0)) * 0.4) * seaNear;
        // White water where a river falls steeply (patch-data.ts, rapids):
        // churned foam tearing past, broken near to, and solid white where
        // the drop is a waterfall. Kept from afar, as a thread of white down
        // a cliff, because that is what tells a fall from a glide.
        // The current (patch-data.ts, current): ripples and foam carried
        // downstream, streaked along the flow. Read twice, half a cycle
        // apart, each carried for a cycle and then begun again elsewhere,
        // and blended so neither is seen to jump: carried for ever, a bend
        // would stretch the pattern without end (a flow map).
        float run = length(v_current);
        vec3 runDir = run > 1e-4 ? v_current / run : vec3(0.0);
        vec3 flowP = (vDetailPosition - runDir * dot(vDetailPosition, runDir) * 0.7) * 2600.0;
        float cycle = detailTime * 0.3;
        float phaseA = fract(cycle);
        float phaseB = fract(cycle + 0.5);
        float toB = abs(2.0 * phaseA - 1.0);
        vec3 carry = v_current * 2.6;
        float rippleA = detailNoise(flowP - carry * phaseA + 3.1 * floor(cycle));
        float rippleB = detailNoise(flowP - carry * phaseB + 7.3 * floor(cycle + 0.5));
        float ripple = mix(rippleA, rippleB, toB);
        // Bright streaks running down a river, near to.
        diffuseColor.rgb += vec3(0.07, 0.08, 0.08) * smoothstep(0.55, 0.85, ripple) * min(run, 1.0) * v_inland * seaNear;
        float tumble = run > 1e-4 ? ripple : detailNoise(vDetailPosition * 2600.0 + drift * 9000.0);
        float tear = detailNoise(vDetailPosition * 900.0 - drift * 5000.0);
        float rapid = v_rapids * (1.0 - smoothstep(0.4, 0.9, v_ice));
        // Aerated water between the streaks, paler and greener than a pool.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.72, 0.72), rapid * 0.35);
        float whitewater = rapid * 0.9 * smoothstep(0.78 - rapid * 0.3, 0.98 - rapid * 0.2, tumble * 0.6 + tear * 0.6);
        foam = max(foam, mix(whitewater, rapid * 0.6, 1.0 - seaNear));
        float white = clamp(foam + caps, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.97), white);
        diffuseColor.a = mix(diffuseColor.a, 0.95, white);
        // Deep water keeps its own colour: clear only over the shallows,
        // where the floor is worth seeing. Clear everywhere, the floor under
        // it — and how much of it the angle let through — set the colour of
        // the open sea, which shifted as the glide pitched.
        diffuseColor.a = mix(diffuseColor.a, 0.9, max(smoothstep(0.0, 0.012, v_depth), v_inland * smoothstep(0.0, 0.0004, v_depth)));
        // Pack ice floats on the water, slabs split by dark leads, and does
        // not mirror the sky.
        float packIce = smoothstep(0.9, 1.0, v_ice);
        if (packIce > 0.0) {
          float iceSpan = length(fwidth(vDetailPosition)) * 600.0;
          float lead = 1.0 - smoothstep(0.0, 0.05 + iceSpan * 0.3, abs(detailNoise(vDetailPosition * 600.0) - 0.5));
          float slab = 0.88 + 0.12 * detailNoise(vDetailPosition * 160.0);
          float onIce = packIce * (1.0 - lead * 0.85 * (1.0 - smoothstep(0.3, 1.0, iceSpan)));
          diffuseColor.rgb = mix(diffuseColor.rgb, seaIce * slab, onIce);
          diffuseColor.a = mix(diffuseColor.a, 1.0, onIce);
          white = max(white, onIce);
        }
        diffuseColor.rgb *= 1.0 - cloudShadow(vDetailPosition) * 0.5;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // The sky in the water: Schlick's Fresnel on the rippled normal,
          // so the sea mirrors the air at a grazing angle and shows its own
          // colour looking down. Opaque where it mirrors, as water is.
          float facing = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float mirror = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
          // What it mirrors is the sky the reflected ray meets: the haze at
          // the horizon at a grazing angle, the deeper sky overhead looking
          // down — so the sea is not one flat sheet of the horizon's colour.
          vec3 bounced = reflect(normalize(-vViewPosition), normal);
          float rise = clamp(dot(bounced, normalize(v_up)), 0.0, 1.0);
          vec3 mirrored = mix(seaSky, seaZenith, smoothstep(0.0, 0.45, rise));
          totalEmissiveRadiance += mirrored * mirror * (1.0 - white);
          diffuseColor.a = mix(diffuseColor.a, 1.0, mirror * 0.85);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 swell = vec3(detailTime * 0.9, detailTime * 0.6, -detailTime * 0.7);
          float ripple =
            (detailNoise(vDetailPosition * 900.0 + swell) +
              detailNoise(vDetailPosition * 2200.0 - swell * 1.7) * 0.6) * seaNear;
          normal = detailBump(
            -vViewPosition,
            normal,
            vec2(dFdx(ripple), dFdy(ripple)) * 0.5,
            faceDirection);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // The rings' shadow falls on the water as on the ground: on the
        // sun's light only, so the sky it mirrors is untouched.
        {
          float ringDim = (1.0 - ringShadowFrom(vDetailPosition, detailCloudSun)) * (1.0 - moonShadowFrom(vDetailPosition, detailCloudSun));
          reflectedLight.directDiffuse *= ringDim;
          reflectedLight.directSpecular *= ringDim;
          // From under the sea the surface is a bright, moving ceiling: the
          // sky let through, rippled. Its underside faces away from the sun
          // and would otherwise be drawn dark.
          if (!gl_FrontFacing) {
            float ripple = detailNoise(vDetailPosition * 2200.0 + vec3(detailTime * 0.5, 0.0, -detailTime * 0.4));
            reflectedLight.indirectDiffuse += vec3(0.35, 0.75, 0.8) * (0.6 + ripple * 0.8) * detailUnder;
          }
        }`,
      )
    withValleyFog(shader, 'mistTop')
  }
  material.customProgramCacheKey = () => 'planet-water-detail'
  return material
}

/**
 * Lava: a crust of plates carried on a slow current, split by glowing
 * seams with brighter lava streaming along them. The current is a noise
 * field, and the crust is read twice along it with the two reads
 * cross-faded (flow mapping), which is what lets a pattern move without
 * stretching forever.
 */
export function withLavaDetail(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    passThrough(shader, undefined)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      {
        float lavaDistance = length(vViewPosition);
        float far = smoothstep(0.3, 1.5, lavaDistance);
        vec3 up = normalize(vDetailPosition);
        vec3 current = vec3(
          detailNoise(vDetailPosition * 9.0 + 3.1),
          detailNoise(vDetailPosition * 9.0 + 7.7),
          detailNoise(vDetailPosition * 9.0 + 1.3)) - 0.5;
        current -= up * dot(current, up);
        current = normalize(current + 1e-5) * 0.0035;
        // Two phases of the same crust, half a cycle apart, each carried
        // along the current and faded out before it has moved far.
        float cycle = 0.12;
        float t1 = fract(detailTime * cycle);
        float t2 = fract(detailTime * cycle + 0.5);
        vec3 p1 = vDetailPosition - current * ((t1 - 0.5) / cycle);
        vec3 p2 = vDetailPosition - current * ((t2 - 0.5) / cycle);
        float blend = abs(t1 - 0.5) * 2.0;
        vec3 platesA = detailCells(p1 * 70.0);
        vec3 platesB = detailCells(p2 * 70.0);
        float seamA = 1.0 - smoothstep(0.0, 0.12, platesA.y - platesA.x);
        float seamB = 1.0 - smoothstep(0.0, 0.12, platesB.y - platesB.x);
        float seam = mix(seamA, seamB, blend);
        float id = mix(platesA.z, platesB.z, blend);
        if (far < 0.99) {
          vec3 chipsA = detailCells(p1 * 700.0);
          vec3 chipsB = detailCells(p2 * 700.0);
          float fine = mix(
            1.0 - smoothstep(0.0, 0.1, chipsA.y - chipsA.x),
            1.0 - smoothstep(0.0, 0.1, chipsB.y - chipsB.x),
            blend);
          seam = max(seam, fine * (1.0 - far));
        }
        // Lava streaming along the seams, quicker than the crust.
        float stream = detailNoise((vDetailPosition - current * detailTime * 4.0) * 260.0);
        float pulse = 0.85 + 0.15 * sin(detailTime * 1.3 + id * 6.28);
        totalEmissiveRadiance *= mix(0.12 + id * 0.15, (1.6 + stream * 1.4) * pulse, seam);
        diffuseColor.rgb *= mix(0.4, 1.0, seam);
      }`,
    )
  }
  material.customProgramCacheKey = () => 'planet-lava-detail'
  return material
}
