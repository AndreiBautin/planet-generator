import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { FEATURES, type Feature } from '@/generation/features'

import { DETAIL_NORMAL_MATRIX, DETAIL_RANGE, DETAIL_TIME, NOISE } from '../detail'
import { HAZE_SUN } from '../haze'
import type { GroundLayer } from '../textures'
import { STRIDE, type Scatter } from './scatter'

/**
 * The features as models, several shapes per kind, drawn as instances: a
 * thousand trees in a wood are a handful of draw calls. Each instance stands
 * up from the ground, turned and sized as the scatterer decided, and tinted
 * its own colour — the models are white where the instance colour should
 * show and dark where a trunk is.
 *
 * Smooth-shaded and roughened, not faceted. The first models were flat
 * low-poly solids — a dodecahedron for a rock, an icosahedron for a crown —
 * and read as a console game from the nineties; every vertex of a rock or
 * a crown is now pushed in or out by a hash of where it is, so no two faces
 * meet at a clean edge, and the normals are smoothed over them. Rock,
 * boulders, columns and cones also wear the ground's stone photograph,
 * laid on triplanar in the planet's frame, so a rock is made of the same
 * stuff as the cliff behind it. Ice floes stay faceted: a floe is a flat
 * plate with a broken edge, and that is what facets are.
 */

/** How tall a feature of size 1 stands, in planet radii. */
export const FEATURE_HEIGHT = 0.0011

const TRUNK = new THREE.Color(0.32, 0.24, 0.17)
const WHITE = new THREE.Color(1, 1, 1)
/** The floor of a crater: lit from within, so it is not tinted with the cone. */
const EMBER = new THREE.Color(2.4, 0.55, 0.12)

/** A hash of a point, −0.5 to 0.5, for roughening without a noise table. */
function jitter(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 1000) + 17, 0x27d4eb2f)
  h ^= Math.imul(Math.round(y * 1000) + 31, 0x165667b1)
  h ^= Math.imul(Math.round(z * 1000) + 47, 0x9e3779b1)
  h ^= Math.imul(salt + 1, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296 - 0.5
}

/**
 * Push every vertex in or out from the shape's centre by a share of its
 * distance, by a hash of the vertex, so the shape is lumpy rather than a
 * clean solid. Indexed geometry keeps its shared vertices, so the surface
 * stays closed and smooth normals can be found over it afterwards.
 */
function roughen(
  geometry: THREE.BufferGeometry,
  amount: number,
  salt: number,
): THREE.BufferGeometry {
  const positions = geometry.getAttribute('position')
  for (let at = 0; at < positions.count; at += 1) {
    const x = positions.getX(at)
    const y = positions.getY(at)
    const z = positions.getZ(at)
    const scale = 1 + jitter(x, y, z, salt) * amount
    positions.setXYZ(at, x * scale, y * scale, z * scale)
  }
  positions.needsUpdate = true
  return geometry
}

/** Paint a part one colour and say whether it is stone (wears the ground's photograph). */
function painted(
  geometry: THREE.BufferGeometry,
  colour: THREE.Color,
  options: { readonly stone?: boolean; readonly faceted?: boolean } = {},
): THREE.BufferGeometry {
  const part =
    options.faceted === true && geometry.index !== null ? geometry.toNonIndexed() : geometry
  const count = part.getAttribute('position').count
  const colours = new Float32Array(count * 3)
  const stony = new Float32Array(count)
  for (let at = 0; at < count; at += 1) {
    colours[at * 3] = colour.r
    colours[at * 3 + 1] = colour.g
    colours[at * 3 + 2] = colour.b
    stony[at] = options.stone === true ? 1 : 0
  }
  part.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  part.setAttribute('stony', new THREE.BufferAttribute(stony, 1))
  part.deleteAttribute('uv')
  return part
}

function merged(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Parts may be indexed or not; merging wants them alike.
  const alike = parts.map((part) => (part.index === null ? part : part.toNonIndexed()))
  const geometry = mergeGeometries(alike)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The crown of a conifer as stacked tiers of branches: each tier a cone
 * whose rim is cut into points (branch tips) and pulled down at the ends,
 * every tier turned so the points do not line up. A smooth cone read as a
 * traffic cone; the broken silhouette is what makes it read as a tree.
 */
function tiers(
  count: number,
  base: number,
  start: number,
  spacing: number,
  salt: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  for (let tier = 0; tier < count; tier += 1) {
    const t = tier / Math.max(1, count - 1)
    const radius = base * (1 - t * 0.78)
    const height = spacing * 2.1 * (1 - t * 0.35)
    const sides = 14
    const cone = new THREE.ConeGeometry(radius, height, sides, 2, true)
    const positions = cone.getAttribute('position')
    const twist = jitter(tier, salt, 0, 3) * 6
    for (let at = 0; at < positions.count; at += 1) {
      const x = positions.getX(at)
      const y = positions.getY(at)
      const z = positions.getZ(at)
      const out = Math.hypot(x, z)
      if (out < 1e-6) continue
      const angle = Math.atan2(z, x) + twist
      const rim = out / radius
      const tip =
        0.72 + 0.4 * Math.max(0, Math.cos(angle * 7)) + jitter(x, y, z, salt + tier) * 0.25
      const scale = 1 + (tip - 1) * rim
      // Branch ends droop below the tier's rim.
      const droop = rim * rim * radius * 0.25 * tip
      positions.setXYZ(at, x * scale, y - droop, z * scale)
    }
    positions.needsUpdate = true
    out.push(painted(cone.translate(0, start + tier * spacing + height / 2, 0), WHITE))
  }
  return out
}

/** An ice floe: a thin slab whose rim wanders in and out, its top a shallow dome. */
function floe(salt: number): THREE.BufferGeometry {
  const sides = 22
  const geometry = new THREE.CylinderGeometry(0.5, 0.47, 0.045, sides, 1)
  const positions = geometry.getAttribute('position')
  const phase = [salt * 1.7 + 0.3, salt * 2.9 + 1.1, salt * 0.7 + 2.3]
  for (let at = 0; at < positions.count; at += 1) {
    const x = positions.getX(at)
    const y = positions.getY(at)
    const z = positions.getZ(at)
    const angle = Math.atan2(z, x)
    const rim =
      1 +
      Math.sin(angle * 2 + (phase[0] ?? 0)) * 0.16 +
      Math.sin(angle * 3 + (phase[1] ?? 0)) * 0.1 +
      Math.sin(angle * 7 + (phase[2] ?? 0)) * 0.05 +
      jitter(Math.cos(angle), 0, Math.sin(angle), salt + 31) * 0.12
    const out = Math.hypot(x, z)
    const dome = y > 0 ? (1 - Math.min(1, out * 2)) * 0.02 : 0
    positions.setXYZ(at, x * rim, y + dome + 0.01, z * rim * 0.8)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/** A smooth lump: an icosahedron subdivided and roughened. */
const lump = (radius: number, detail: number, rough: number, salt: number): THREE.BufferGeometry =>
  roughen(new THREE.IcosahedronGeometry(radius, detail), rough, salt)

const STONE = { stone: true } as const

/**
 * Each kind's models, standing on their origin with up along +y, a unit
 * tall: several shapes for the kinds there are many of, so a wood is not
 * one tree stamped a thousand times. Which shape an instance gets comes
 * from its place in the tile, so it is the same shape every time.
 */
function modelsOf(feature: Feature): THREE.BufferGeometry[] {
  switch (feature) {
    case 'conifer':
      return [
        // A spruce: five tiers of drooping branches, narrowing upwards.
        merged([
          painted(new THREE.CylinderGeometry(0.04, 0.07, 0.3, 7).translate(0, 0.15, 0), TRUNK),
          ...tiers(5, 0.36, 0.16, 0.18, 1),
        ]),
        // A fir: many tight tiers on a tall slim spire.
        merged([
          painted(new THREE.CylinderGeometry(0.035, 0.06, 0.22, 7).translate(0, 0.11, 0), TRUNK),
          ...tiers(7, 0.26, 0.12, 0.14, 3),
        ]),
        // A pine: bare trunk, a few ragged tiers high up.
        merged([
          painted(new THREE.CylinderGeometry(0.045, 0.07, 0.55, 7).translate(0, 0.275, 0), TRUNK),
          ...tiers(3, 0.34, 0.5, 0.15, 4),
        ]),
      ]
    case 'broadleaf':
      return [
        // Round-crowned.
        merged([
          painted(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 7).translate(0, 0.2, 0), TRUNK),
          painted(lump(0.42, 2, 0.22, 6).scale(1, 0.8, 1).translate(0, 0.62, 0), WHITE),
          painted(lump(0.27, 1, 0.22, 7).translate(0.22, 0.5, 0.12), WHITE),
        ]),
        // Tall and narrow, a poplar.
        merged([
          painted(new THREE.CylinderGeometry(0.04, 0.07, 0.3, 7).translate(0, 0.15, 0), TRUNK),
          painted(lump(0.3, 2, 0.2, 8).scale(0.8, 1.3, 0.8).translate(0, 0.62, 0), WHITE),
        ]),
        // Spreading, two lobes leaning apart, an oak.
        merged([
          painted(new THREE.CylinderGeometry(0.06, 0.1, 0.35, 7).translate(0, 0.175, 0), TRUNK),
          painted(lump(0.34, 2, 0.24, 9).scale(1.1, 0.75, 1).translate(-0.18, 0.55, 0), WHITE),
          painted(lump(0.3, 2, 0.24, 10).scale(1.1, 0.8, 1).translate(0.2, 0.62, 0.1), WHITE),
          painted(lump(0.22, 1, 0.24, 11).translate(0.02, 0.8, -0.1), WHITE),
        ]),
      ]
    case 'shrub':
      return [
        merged([
          painted(lump(0.3, 1, 0.3, 12).scale(1.2, 0.7, 1).translate(0, 0.15, 0), WHITE),
          painted(lump(0.2, 1, 0.3, 13).translate(0.22, 0.12, -0.08), WHITE),
        ]),
        merged([
          painted(lump(0.22, 1, 0.3, 14).scale(1, 0.9, 1).translate(-0.12, 0.16, 0.05), WHITE),
          painted(lump(0.26, 1, 0.3, 15).scale(1.1, 0.7, 1.1).translate(0.14, 0.12, -0.1), WHITE),
          painted(lump(0.16, 1, 0.3, 16).translate(0, 0.3, 0.12), WHITE),
        ]),
      ]
    case 'grass':
      // Three blades leaning apart: a tuft, read as turf when there are
      // hundreds.
      return [
        merged([
          painted(new THREE.ConeGeometry(0.08, 0.6, 3).translate(0, 0.3, 0), WHITE),
          painted(
            new THREE.ConeGeometry(0.07, 0.5, 3).rotateZ(0.5).translate(0.12, 0.22, 0.05),
            WHITE,
          ),
          painted(
            new THREE.ConeGeometry(0.07, 0.45, 3).rotateZ(-0.45).translate(-0.1, 0.2, -0.06),
            WHITE,
          ),
        ]),
      ]
    case 'cone':
      // A cinder cone: a wide squat mound with a crater of cooled lava.
      return [
        merged([
          painted(
            roughen(new THREE.CylinderGeometry(0.22, 0.6, 0.45, 18, 3), 0.08, 17).translate(
              0,
              0.225,
              0,
            ),
            WHITE,
            STONE,
          ),
          painted(new THREE.CylinderGeometry(0.17, 0.2, 0.04, 18).translate(0, 0.45, 0), EMBER),
        ]),
      ]
    case 'cactus':
      return [
        merged([
          painted(new THREE.CylinderGeometry(0.09, 0.1, 0.8, 9).translate(0, 0.4, 0), WHITE),
          painted(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 9).translate(0.15, 0.48, 0), WHITE),
          painted(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 9).translate(-0.14, 0.38, 0), WHITE),
        ]),
      ]
    case 'rock':
      return [
        merged([
          painted(lump(0.32, 2, 0.4, 18).scale(1.2, 0.65, 1).translate(0, 0.1, 0), WHITE, STONE),
        ]),
        // A slab, long and low.
        merged([
          painted(lump(0.3, 2, 0.3, 19).scale(1.6, 0.45, 0.9).translate(0, 0.08, 0), WHITE, STONE),
        ]),
      ]
    case 'boulder':
      return [
        // Two lumps leaning together, so a boulder is not a stretched rock.
        merged([
          painted(lump(0.34, 2, 0.35, 20).scale(1.1, 0.8, 1).translate(0, 0.15, 0), WHITE, STONE),
          painted(
            lump(0.22, 2, 0.35, 21).scale(1, 0.75, 1).translate(0.27, 0.06, 0.12),
            WHITE,
            STONE,
          ),
        ]),
        // One tall block, tilted a little.
        merged([
          painted(
            lump(0.3, 2, 0.3, 22).scale(0.9, 1.2, 0.8).rotateZ(0.2).translate(0, 0.25, 0),
            WHITE,
            STONE,
          ),
        ]),
      ]
    case 'spire':
      // Columns of three heights: basalt organ pipes, or a serac of ice.
      // Faceted: a column is six flat faces, and so is a serac.
      return [
        merged([
          painted(new THREE.CylinderGeometry(0.11, 0.13, 1, 6).translate(0, 0.5, 0), WHITE, {
            stone: true,
            faceted: true,
          }),
          painted(
            new THREE.CylinderGeometry(0.1, 0.12, 0.72, 6).translate(0.2, 0.36, 0.07),
            WHITE,
            {
              stone: true,
              faceted: true,
            },
          ),
          painted(
            new THREE.CylinderGeometry(0.09, 0.11, 0.5, 6).translate(-0.1, 0.25, 0.19),
            WHITE,
            {
              stone: true,
              faceted: true,
            },
          ),
        ]),
      ]
    case 'floe':
      // A plate of ice with a broken, irregular edge, riding just proud of
      // the sea. Three outlines, each wandering in and out round the rim:
      // a regular polygon read as a field of hexagonal tiles.
      return [0, 1, 2].map((salt) => painted(floe(salt), WHITE))
  }
}

const models = new Map<Feature, THREE.BufferGeometry[]>()
const modelsFor = (feature: Feature): THREE.BufferGeometry[] => {
  const known = models.get(feature)
  if (known !== undefined) return known
  const made = modelsOf(feature)
  models.set(feature, made)
  return made
}

/** How long a tile's features take to grow up out of the ground, in seconds. */
export const GROW_SECONDS = 0.8

/**
 * The material for one tile's features. One per tile rather than one for
 * all, because each carries the time its tile arrived: its features grow
 * up out of the ground over `GROW_SECONDS` rather than appearing, which is
 * what made a tile arriving late read as a glitch. The program is shared —
 * the cache key is the same — so a tile costs a few uniforms, not a compile.
 *
 * Each instance also shrinks into the ground over the last stretch of the
 * feature range, so a wood thins out towards the horizon rather than
 * stopping at a line where the tiles do; stone wears the ground's stone
 * photograph; and a crown is darker underneath than on top, which is most
 * of what makes a tree read as a solid thing rather than a green blob.
 */
export function featureMaterial(born: number, stone: GroundLayer): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    // The conifers' tiers are open cones, seen from beneath as often as above.
    side: THREE.DoubleSide,
  })
  // When the tile was last made visible after a while hidden (flora.ts).
  const shownAt = { value: -1e9 }
  material.userData.shownAt = shownAt
  material.onBeforeCompile = (shader) => {
    shader.uniforms.featureRange = DETAIL_RANGE
    shader.uniforms.featureNow = DETAIL_TIME
    shader.uniforms.featureBorn = { value: born }
    shader.uniforms.featureShownAt = shownAt
    shader.uniforms.featureStone = stone.color
    shader.uniforms.featureStoneNormal = stone.normal
    shader.uniforms.featureStoneMean = stone.mean
    shader.uniforms.featureNormalMatrix = DETAIL_NORMAL_MATRIX
    shader.uniforms.hazeSun = HAZE_SUN
    shader.vertexShader =
      'uniform float featureRange;\nuniform float featureNow;\nuniform float featureBorn;\nuniform float featureShownAt;\nattribute float stony;\nvarying float vFeatureFade;\nvarying float vFeatureSmall;\nvarying vec3 vFeatureUp;\nvarying vec3 vFeaturePlanet;\nvarying vec3 vFeatureNormal;\nvarying float vFeatureStony;\nvarying float vFeatureHeight;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 featureFoot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float featureGap = length((modelViewMatrix * vec4(featureFoot, 1.0)).xyz);
          float grown = smoothstep(0.0, ${GROW_SECONDS.toFixed(2)}, featureNow - featureBorn);
          // Out at the edge of the range a wood thins out a whole tree at a
          // time, each with its own fixed threshold from where it stands, so
          // nothing flickers as the eye moves. Shrinking every tree read as
          // dark specks, and a per-pixel dither read as static.
          vFeatureFade = 1.0 - smoothstep(featureRange * 0.55, featureRange, featureGap);
          // A tile that comes into view inside the range brings its features
          // in over a moment, each at its own threshold below, rather than
          // all at once.
          vFeatureFade *= smoothstep(0.0, 0.6, featureNow - featureShownAt);
          vec3 featureSeed = fract(featureFoot * 7919.17);
          featureSeed += dot(featureSeed, featureSeed.yzx + 19.19);
          float featureKeep = fract((featureSeed.x + featureSeed.y) * featureSeed.z);
          // Each grows in over a short stretch of distance from its own
          // threshold, rather than switching on: switched, every tree and
          // rock in the band popped into being as the eye crossed its line,
          // which read as things appearing as you flew over them.
          float featureStart = featureKeep * 0.85;
          float featureShown = smoothstep(featureStart, featureStart + 0.15, vFeatureFade);
          transformed *= grown * featureShown;
          // How small it stands on screen: its height over its distance, as
          // a share of the view's height. A tree a few pixels tall cannot
          // hold shading detail still while it moves — its dark underside,
          // light tufts and backlit rim flip pixels frame to frame, which is
          // the speckle a forest broke into — so below a few percent of the
          // screen it is drawn as one quiet tone.
          float featureTall = length((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float featureOnScreen = featureTall / max(featureGap, 1e-6) * projectionMatrix[1][1] * 0.5;
          vFeatureSmall = 1.0 - smoothstep(0.012, 0.035, featureOnScreen);
          vFeatureUp = normalize(normalMatrix * normalize(featureFoot));
          vFeaturePlanet = (instanceMatrix * vec4(transformed, 1.0)).xyz;
          vFeatureNormal = normalize(mat3(instanceMatrix) * objectNormal);
          vFeatureStony = stony;
          vFeatureHeight = position.y;
        }`,
      )
    shader.fragmentShader =
      NOISE +
      'uniform sampler2D featureStone;\nuniform sampler2D featureStoneNormal;\nuniform float featureStoneMean;\nuniform mat3 featureNormalMatrix;\nvarying float vFeatureFade;\nvarying float vFeatureSmall;\nvarying vec3 vFeatureUp;\nvarying vec3 vFeaturePlanet;\nvarying vec3 vFeatureNormal;\nvarying float vFeatureStony;\nvarying float vFeatureHeight;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
        if (vFeatureStony > 0.5) {
          // Stone: the ground's photograph, triplanar in the planet's frame,
          // levelled to its own brightness so the instance colour says what
          // colour the rock is.
          vec3 n = normalize(vFeatureNormal);
          vec3 w = pow(abs(n), vec3(4.0));
          w /= w.x + w.y + w.z;
          vec3 p = vFeaturePlanet * 2600.0;
          vec3 c =
            texture2D(featureStone, p.yz).rgb * w.x +
            texture2D(featureStone, p.xz).rgb * w.y +
            texture2D(featureStone, p.xy).rgb * w.z;
          c /= featureStoneMean * 2.0;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb *= mix(vec3(lum), c, 0.3) * 2.0;
        } else {
          // Shade from the ground up: the underside of a crown and the foot
          // of a trunk sit in their own shadow.
          diffuseColor.rgb *= mix(0.55 + 0.45 * smoothstep(0.0, 0.85, vFeatureHeight), 0.8, vFeatureSmall);
          // Clumps of needles and leaves: light and dark tufts across the
          // crown, faded out before they shrink under a pixel and shimmer.
          float tuftSpan = length(fwidth(vFeaturePlanet)) * 90000.0;
          float tufts = detailNoise(vFeaturePlanet * 90000.0) * 0.65 + detailNoise(vFeaturePlanet * 230000.0) * 0.35;
          diffuseColor.rgb *= mix(1.0, 0.7 + 0.55 * tufts, (1.0 - smoothstep(0.3, 0.9, tuftSpan)) * (1.0 - vFeatureSmall));
        }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
        if (vFeatureStony > 0.5) {
          vec3 n0 = normalize(vFeatureNormal);
          vec3 w = pow(abs(n0), vec3(4.0));
          w /= w.x + w.y + w.z;
          vec3 p = vFeaturePlanet * 2600.0;
          vec3 d = vec3(0.0);
          { vec2 s = texture2D(featureStoneNormal, p.yz).xy * 2.0 - 1.0; d += vec3(0.0, s.x, s.y) * w.x; }
          { vec2 s = texture2D(featureStoneNormal, p.xz).xy * 2.0 - 1.0; d += vec3(s.x, 0.0, s.y) * w.y; }
          { vec2 s = texture2D(featureStoneNormal, p.xy).xy * 2.0 - 1.0; d += vec3(s.x, s.y, 0.0) * w.z; }
          normal = normalize(featureNormalMatrix * normalize(n0 + d * 0.6)) * faceDirection;
        } else {
          // A small tree's facets all lit alike, as if facing up.
          normal = normalize(mix(normal, normalize(vFeatureUp), vFeatureSmall * 0.8));
        }`,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
        // The planet shadows what stands on it: once the sun is under the
        // ground's horizon it lights nothing there, however a facet faces.
        #if NUM_DIR_LIGHTS > 0
        {
          float featureDay = smoothstep(-0.06, 0.1, dot(normalize(vFeatureUp), directionalLights[0].direction));
          reflectedLight.directDiffuse *= featureDay;
          reflectedLight.directSpecular *= featureDay;
          // Sun through the leaves: a crown seen against the light glows at
          // its edges rather than going flat and black.
          if (vFeatureStony < 0.5) {
            float backlit = pow(max(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.0), 4.0);
            reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 1.05, 0.7) * backlit * featureDay * 0.9 * (1.0 - vFeatureSmall);
          }
        }
        #endif`,
        )
  }
  material.customProgramCacheKey = () => 'planet-features'
  return material
}

const up = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)
const stand = new THREE.Quaternion()
const twist = new THREE.Quaternion()
const where = new THREE.Vector3()
const size = new THREE.Vector3()
const matrix = new THREE.Matrix4()
const tint = new THREE.Color()

/** The instanced meshes for a tile's features: one per shape of each kind present. */
export function featuresFor(scatter: Scatter, material: THREE.Material): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = []
  for (const feature of FEATURES) {
    const data = scatter[feature]
    if (data === undefined) continue
    const shapes = modelsFor(feature)
    const count = data.length / STRIDE
    // Deal the instances out among the shapes by their place in the tile:
    // deterministic, and well mixed for any run of neighbours.
    const byShape = shapes.map(() => [] as number[])
    for (let at = 0; at < count; at += 1) byShape[(at * 7919 + 13) % shapes.length]?.push(at)
    shapes.forEach((shape, which) => {
      const members = byShape[which] ?? []
      if (members.length === 0) return
      const mesh = new THREE.InstancedMesh(shape, material, members.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      members.forEach((at, slot) => {
        const o = at * STRIDE
        where.set(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0)
        up.copy(where).normalize()
        // Stand it up from the ground, then turn it about its own axis.
        stand.setFromUnitVectors(Y, up)
        twist.setFromAxisAngle(Y, data[o + 4] ?? 0)
        stand.multiply(twist)
        const s = (data[o + 3] ?? 1) * FEATURE_HEIGHT
        size.set(s, s, s)
        matrix.compose(where, stand, size)
        mesh.setMatrixAt(slot, matrix)
        mesh.setColorAt(slot, tint.setRGB(data[o + 5] ?? 1, data[o + 6] ?? 1, data[o + 7] ?? 1))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      meshes.push(mesh)
    })
  }
  return meshes
}
