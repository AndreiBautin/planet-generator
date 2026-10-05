import * as THREE from 'three'

import { HAZE_SUN } from './haze'
import type { GroundTextures } from './textures'

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
    `uniform float detailTime;\nuniform float detailRange;\nuniform sampler2D detailClouds;\nuniform float detailCloudSpin;\nuniform vec3 detailCloudSun;\nuniform mat3 detailNormalMatrix;\nvarying vec3 vDetailPosition;\nvarying vec3 vDetailNormal;\n${varying}` +
    NOISE +
    CLOUD_SHADOW +
    shader.fragmentShader
  shader.uniforms.detailTime = DETAIL_TIME
  shader.uniforms.detailRange = DETAIL_RANGE
  shader.uniforms.detailClouds = DETAIL_CLOUDS
  shader.uniforms.detailCloudSpin = DETAIL_CLOUD_SPIN
  shader.uniforms.detailCloudSun = DETAIL_CLOUD_SUN
  shader.uniforms.detailNormalMatrix = DETAIL_NORMAL_MATRIX
  shader.uniforms.hazeSun = HAZE_SUN
}

const CLOUD_SHADOW = /* glsl */ `
  // How much cloud lies between this point and the sun: the cloud map read
  // where the sun's ray from here meets the layer, in the layer's own frame
  // (it turns a little faster than the ground). Soft, because the map is.
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
    vec2 o = vec2(0.0018, 0.0018);
    float c0 = texture2D(detailClouds, uv).r * 0.4
      + texture2D(detailClouds, uv + vec2(o.x, 0.0)).r * 0.15
      + texture2D(detailClouds, uv - vec2(o.x, 0.0)).r * 0.15
      + texture2D(detailClouds, uv + vec2(0.0, o.y)).r * 0.15
      + texture2D(detailClouds, uv - vec2(0.0, o.y)).r * 0.15;
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
      'attribute vec3 coarseColour;\nattribute vec4 coarsePattern;\n' +
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
#include <project_vertex>`,
        )
    const layers = ['grass', 'litter', 'sand', 'stone', 'snow', 'basalt'] as const
    let declare = ''
    for (const kind of layers) {
      const name = kind.charAt(0).toUpperCase() + kind.slice(1)
      // The same uniform objects for every material, so a photograph that
      // arrives later reaches every planet's ground at once.
      shader.uniforms[`ground${name}`] = textures[kind].color
      shader.uniforms[`ground${name}Normal`] = textures[kind].normal
      shader.uniforms[`ground${name}Mean`] = textures[kind].mean
      declare += `uniform sampler2D ground${name};\nuniform sampler2D ground${name}Normal;\nuniform float ground${name}Mean;\n`
    }
    shader.fragmentShader =
      declare +
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
          float lava = v_pattern.y;
          if (lava > 0.02) {
            float lavaFar = 1.0 - smoothstep(0.2, 1.2, length(vViewPosition));
            vec3 p = vDetailPosition * 160.0;
            float n = detailNoise(p) + detailNoise(p * 2.7) * 0.35 - 0.675;
            float channel = 1.0 - smoothstep(0.0, 0.035 + 0.03 * (1.0 - lavaFar), abs(n));
            float pool = smoothstep(0.58, 0.75, detailNoise(vDetailPosition * 45.0)) * lava;
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
            float total = 1.0;
            groundLayer(groundBasalt, groundBasaltNormal, groundBasaltMean, 1.0, p, q, w, albedo, relief, detailTilt);`
                : /* glsl */ `
            float wLitter = v_pattern.x * stand;
            float wSand = v_pattern.y;
            float wSnow = v_pattern.z;
            float wStone = v_pattern.w;
            float wGrass = max(0.0, 1.0 - (wLitter + wSand + wSnow + wStone));
            float total = max(0.001, wLitter + wSand + wSnow + wStone + wGrass);
            groundLayer(groundGrass, groundGrassNormal, groundGrassMean, wGrass, p, q, w, albedo, relief, detailTilt);
            groundLayer(groundLitter, groundLitterNormal, groundLitterMean, wLitter, p, q, w, albedo, relief, detailTilt);
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
        float canopy = smoothstep(0.08, 0.26, edge) * (1.0 - stand);
        if (canopy > 0.02) {
          float tone = (0.34 + broad * 0.2) * (0.7 + crown * 0.55);
          detailShade *= mix(1.0, tone, canopy);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.95, 0.78), canopy);
          detailHeight += (crown - 0.5) * 2.0 * canopy;
          detailRough = mix(detailRough, 0.95, canopy);
        }

        // No sand ripples, snow ridges or stone cracks drawn by hand here.
        // Each was drawn only within a certain distance, so each appeared
        // ahead of the eye as it flew — and the cracks, on a world that is
        // mostly stone, read as a honeycomb over the whole ground. The
        // photographs above carry the grain, and the GPU filters them
        // smoothly at every distance, so nothing of theirs pops.

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
      'attribute float coarseDepth;\nattribute vec2 ice;\nvarying float v_ice;\n' +
      shader.vertexShader
    )
      .replace(
        'void main() {',
        'void main() {\n  float seaMorph = terrainMorphAt(position);\n  float seaDepth = mix(depth, coarseDepth, seaMorph);\n  v_ice = mix(ice.x, ice.y, seaMorph);',
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
          float lift = (1.0 - smoothstep(0.02, 0.14, seaView)) * smoothstep(0.0, 0.0004, seaDepth) * (1.0 - smoothstep(0.05, 0.4, v_ice));
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
        transformed += waveOffset;`,
        )
    shader.uniforms.seaSky = DETAIL_SKY
    const seaIce: unknown = material.userData.seaIce
    shader.uniforms.seaIce = {
      value: seaIce instanceof THREE.Color ? seaIce : new THREE.Color(0.9, 0.94, 0.97),
    }
    shader.fragmentShader =
      'uniform vec3 seaSky;\nuniform vec3 seaIce;\nvarying float v_ice;\nvarying float v_jac;\nvarying float v_heave;\n' +
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
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7, shallows * 0.45);
        diffuseColor.rgb *= 1.0 + v_heave * 0.18;
        // Foam where the sea meets the land, broken and moving.
        float shore = 1.0 - smoothstep(0.0, 0.0009, v_depth);
        float churn = detailNoise(vDetailPosition * 1500.0 + drift * 1500.0);
        float foam = shore * smoothstep(0.45, 0.8, churn + shore * 0.35) * (1.0 - smoothstep(0.05, 0.5, seaDistance));
        // Breaking crests: where the wave has squeezed the surface most,
        // streaked by a noise so the foam is ragged, and the odd cap at sea.
        float breaking = smoothstep(0.62, 0.42, v_jac);
        float streak = smoothstep(0.35, 0.75, detailNoise(vDetailPosition * 1800.0 + drift * 1200.0));
        float caps = max(breaking * (0.4 + streak * 0.6), smoothstep(0.9, 0.98, detailNoise(vDetailPosition * 1100.0 - drift * 1100.0)) * 0.4) * seaNear;
        float white = clamp(foam + caps, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.97), white);
        diffuseColor.a = mix(diffuseColor.a, 0.95, white);
        // Deep water keeps its own colour: clear only over the shallows,
        // where the floor is worth seeing. Clear everywhere, the floor under
        // it — and how much of it the angle let through — set the colour of
        // the open sea, which shifted as the glide pitched.
        diffuseColor.a = mix(diffuseColor.a, 0.9, smoothstep(0.0, 0.012, v_depth));
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
          totalEmissiveRadiance += seaSky * mirror * (1.0 - white);
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
