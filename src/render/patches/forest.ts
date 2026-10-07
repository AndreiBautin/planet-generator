import * as THREE from 'three'

import { DETAIL_CLOUD_SUN, DETAIL_NORMAL_MATRIX, TERRAIN_MORPH } from '../detail'
import { DETAIL_MOONS, MOON_SHADOW } from '../eclipse'
import { DETAIL_SEASON, LEAF_SEASON_GLSL } from '../leaves'
import { TOWN_GLOW_GLSL, withTownGlow } from '../town-glow'
import { withValleyFog } from '../valley-fog'
import type { PatchData } from './patch-data'

/**
 * The woods, as level of detail on the ground's own terms.
 *
 * Trees stand on the vertices of the ground's patches. At `TREE_LEVEL` a
 * vertex is a tree's place; finer ground shows the trees of its ancestor at
 * that level (terrain.ts), whose vertices are its own every second or
 * fourth one — so a tree stands exactly on the ground whatever level is
 * drawn under it. Coarser patches have a quarter as many vertices a level
 * up, and each stands for the four trees it replaces: drawn twice the
 * size, a clump rather than a tree.
 *
 * The change between levels is the ground's own blend. Over the distance
 * where a patch gives way to its parent, the trees on its odd vertices —
 * the ones the parent does not have — shrink to nothing, and the trees on
 * the vertices it shares with the parent grow to the parent's size; the
 * parent then draws exactly what was drawn. So nothing appears: a wood
 * thins and coarsens with distance continuously, and nothing waits on a
 * worker, as the ground already holds every vertex the trees need.
 *
 * Which vertices hold a tree is the painted canopy (`pattern.x`, which the
 * ground draws its woods from) against a hash of where the vertex is, so a
 * vertex shared by two levels makes the same decision in both.
 */
export const TREE_LEVEL = 6
/** The coarsest level that carries trees; past it they shrink away entirely. */
export const TREE_COARSEST = 4
/** How tall a tree of size 1 stands, in planet radii. */
const TREE_HEIGHT = 0.0015

const TRUNK = new THREE.Color(0.3, 0.22, 0.15)
const LEAF = new THREE.Color(1, 1, 1)

/**
 * Both trees as one model: the same lathe — rings of the same number of
 * points about the trunk — drawn to two outlines, a conifer's stepped
 * tiers (`position`) and a broadleaf's rounded crown (`broadleaf`), which
 * an instance blends between by its kind. One draw a patch where two
 * meshes, one per kind, were half the frame's draw calls on a phone, and
 * no vertices spent on the kind not drawn.
 *
 * Each outline runs from the foot of the trunk to the tip: the first two
 * points are bark, the rest leaf.
 */
const CONIFER: readonly (readonly [number, number])[] = [
  [0.05, 0],
  [0.05, 0.25],
  [0.34, 0.27],
  [0.06, 0.55],
  [0.25, 0.53],
  [0.05, 0.8],
  [0.001, 1.05],
]
const BROADLEAF: readonly (readonly [number, number])[] = [
  [0.06, 0],
  [0.06, 0.32],
  [0.3, 0.36],
  [0.42, 0.56],
  [0.36, 0.76],
  [0.18, 0.92],
  [0.001, 0.97],
]
/** Sides round the trunk: five reads as round at a tree's size on screen, and is sixty triangles a tree. */
const AROUND = 5

const MODEL = (() => {
  const lathe = (outline: readonly (readonly [number, number])[]): THREE.LatheGeometry =>
    new THREE.LatheGeometry(
      outline.map(([r, y]) => new THREE.Vector2(r, y)),
      AROUND,
    )
  const tree = lathe(CONIFER)
  const crown = lathe(BROADLEAF)
  // A broadleaf's crown is lumpy rather than turned: each of its points
  // pushed in or out a little, by where it is.
  const round = crown.getAttribute('position')
  for (let k = 0; k < round.count; k += 1) {
    const x = round.getX(k)
    const y = round.getY(k)
    const z = round.getZ(k)
    const bump = y > 0.33 ? 1 + 0.14 * Math.sin(x * 23 + y * 17) * Math.cos(z * 19 - y * 11) : 1
    round.setXYZ(k, x * bump, y, z * bump)
  }
  crown.computeVertexNormals()
  tree.computeVertexNormals()
  tree.setAttribute('broadleaf', round)
  tree.setAttribute('broadleafNormal', crown.getAttribute('normal'))
  // Bark below, leaf above: the lathe's points go round each ring in turn.
  const count = tree.getAttribute('position').count
  const colours = new Float32Array(count * 3)
  const rings = CONIFER.length
  for (let k = 0; k < count; k += 1) {
    const ring = k % rings
    const bark = ring < 2
    colours[k * 3] = bark ? TRUNK.r : LEAF.r
    colours[k * 3 + 1] = bark ? TRUNK.g : LEAF.g
    colours[k * 3 + 2] = bark ? TRUNK.b : LEAF.b
  }
  tree.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  tree.deleteAttribute('uv')
  return tree
})()

/** A hash of a direction, 0 to 1, the same whichever patch holds the vertex. */
function hashOf(x: number, y: number, z: number, salt: number): number {
  const length = Math.hypot(x, y, z) || 1
  let h = Math.imul(Math.round((x / length) * 2e6) + salt, 0x27d4eb2f)
  h ^= Math.imul(Math.round((y / length) * 2e6) + 31, 0x165667b1)
  h ^= Math.imul(Math.round((z / length) * 2e6) + 47, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** What a tree instance is told: where it stands at this level and the parent's, and how it is to fare. */
const STRIDE = 15

/**
 * The trees of one patch, if it carries any (levels `TREE_COARSEST` to
 * `TREE_LEVEL`): two instanced meshes, conifers and broadleaves, over the
 * vertices that might hold a tree at this level or its parent's.
 */
export function forestFor(
  patch: PatchData,
  level: number,
  segments: number,
  material: THREE.Material,
  depth: THREE.Material,
  tints: { readonly conifer: THREE.Color; readonly broadleaf: THREE.Color },
): THREE.Mesh[] {
  if (level < TREE_COARSEST || level > TREE_LEVEL) return []
  const side = segments + 1
  const found: number[] = []
  // Each vertex stands for 4^(TREE_LEVEL − level) trees, so is drawn that much bigger in area.
  const scale = 2 ** (TREE_LEVEL - level)
  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      const v = j * side + i
      const x = patch.positions[v * 3] ?? 0
      const y = patch.positions[v * 3 + 1] ?? 0
      const z = patch.positions[v * 3 + 2] ?? 1
      const chance = hashOf(x, y, z, 7)
      const fine = patch.pattern[v * 4] ?? 0
      const coarse = patch.coarsePattern[v * 4] ?? 0
      // Out of the wood at this level and the parent's: nothing to draw.
      if (Math.max(fine, coarse) * 1.15 < chance) continue
      // A vertex the parent does not have shrinks away as the parent nears;
      // one it shares grows to the parent's size. At the coarsest level,
      // with no parent drawing trees, all of them shrink away.
      const shared = i % 2 === 0 && j % 2 === 0 && level > TREE_COARSEST
      const needles = patch.ground[v * 8] ?? 0
      const kind = hashOf(x, y, z, 11) < needles / Math.max(fine, 0.05) ? 'conifer' : 'broadleaf'
      const roll = hashOf(x, y, z, 13)
      const tint = tints[kind]
      const shade = 0.8 + hashOf(x, y, z, 17) * 0.4
      found.push(
        x,
        y,
        z,
        patch.coarsePositions[v * 4] ?? x,
        patch.coarsePositions[v * 4 + 1] ?? y,
        patch.coarsePositions[v * 4 + 2] ?? z,
        level,
        shared ? 1 : 0,
        kind === 'conifer' ? 0 : 1,
        chance,
        fine,
        coarse,
        (0.6 + roll * 0.8) * scale,
        // The colour packed into one float, three bytes' worth of shade.
        Math.floor(Math.min(1, tint.r * shade) * 255) * 65536 +
          Math.floor(Math.min(1, tint.g * shade) * 255) * 256 +
          Math.floor(Math.min(1, tint.b * shade) * 255),
        patch.mist[v] ?? 0,
      )
    }
  }
  const bounds = new THREE.Box3()
    .setFromBufferAttribute(
      new THREE.BufferAttribute(patch.positions.subarray(0, side * side * 3), 3),
    )
    .getBoundingSphere(new THREE.Sphere())
  bounds.radius += TREE_HEIGHT * 1.5 * scale * 2
  const count = found.length / STRIDE
  if (count === 0) return []
  const geometry = new THREE.InstancedBufferGeometry()
  for (const [name, attribute] of Object.entries(MODEL.attributes))
    geometry.setAttribute(name, attribute)
  geometry.setIndex(MODEL.index)
  const buffer = new THREE.InstancedInterleavedBuffer(Float32Array.from(found), STRIDE, 1)
  geometry.setAttribute('treeFine', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
  geometry.setAttribute('treeCoarse', new THREE.InterleavedBufferAttribute(buffer, 3, 3))
  geometry.setAttribute('treeFate', new THREE.InterleavedBufferAttribute(buffer, 3, 6))
  geometry.setAttribute('treeWood', new THREE.InterleavedBufferAttribute(buffer, 3, 9))
  geometry.setAttribute('treeLook', new THREE.InterleavedBufferAttribute(buffer, 2, 12))
  geometry.setAttribute('treeMist', new THREE.InterleavedBufferAttribute(buffer, 1, 14))
  geometry.instanceCount = count
  // Culled by the patch's own bounds, grown by the tallest a tree here
  // can stand: the model's own bounds know nothing of where instances go.
  geometry.boundingSphere = bounds
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.customDepthMaterial = depth
  const meshes = [mesh]
  return meshes
}

/**
 * Where a tree stands and how big, in the vertex shader: on the ground as
 * the ground is blended between this level and its parent, sized by its
 * fate in that blend, stood up along the vertical and turned by its hash.
 */
const TREE_VERTEX = /* glsl */ `
uniform vec2 terrainMorphLod;
attribute vec3 treeFine;
attribute vec3 treeCoarse;
attribute vec3 treeFate;
attribute vec3 broadleaf;
attribute vec3 broadleafNormal;
attribute vec3 treeWood;
attribute vec2 treeLook;
varying vec3 vTreeTint;
varying float vTreeHeight;
varying vec3 vTreeUp;
varying vec3 vTreePlanet;
float treeMorph() {
  float level = treeFate.x;
  float parentSpan = 1.5707963 / exp2(level - 1.0);
  float splits = parentSpan / terrainMorphLod.x / terrainMorphLod.y;
  float away = distance((modelMatrix * vec4(treeFine, 1.0)).xyz, cameraPosition);
  return smoothstep(0.5 * splits, 0.85 * splits, away);
}
mat3 treeFrame(vec3 up, float turn) {
  vec3 side = normalize(cross(abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), up));
  vec3 ahead = cross(up, side);
  float c = cos(turn);
  float s = sin(turn);
  vec3 a = side * c + ahead * s;
  vec3 b = -side * s + ahead * c;
  return mat3(a, up, b);
}
`

const TREE_PLACE = /* glsl */ `
  float morph = treeMorph();
  vec3 ground = mix(treeFine, treeCoarse, morph);
  // In the wood at the blend between this level and the parent's.
  float wood = mix(treeWood.y, treeWood.z, morph) * 1.15;
  float present = smoothstep(treeWood.x, treeWood.x + 0.08, wood);
  // Shared with the parent: grows to its size. Not: shrinks away.
  float fate = treeFate.y > 0.5 ? mix(1.0, 2.0, morph) : 1.0 - morph;
  float size = treeLook.x * ${TREE_HEIGHT.toFixed(6)} * fate * present;
  vec3 up = normalize(ground);
  mat3 frame = treeFrame(up, treeWood.x * 40.0);
  // Set a little into the ground, so a trunk on a slope is not floating.
  // A conifer's outline or a broadleaf's, by the tree's kind — then made
  // this tree's own, so a wood is not one model stamped out: wider or
  // slimmer, taller or squatter, its tiers or its crown irregular, and
  // leaning a little its own way, all from its hash.
  vec3 shape = mix(position, broadleaf, treeFate.z);
  vec3 treeOwn = fract(treeWood.x * vec3(13.71, 29.37, 51.13));
  float leafy = step(0.3, shape.y);
  float around = atan(shape.z, shape.x);
  // A conifer's tiers each their own width; a broadleaf's crown lobed.
  float tier = mix(0.82, 1.18, fract(sin(shape.y * 41.0 + treeOwn.x * 23.0) * 43758.5));
  float lobes = 1.0 + 0.2 * sin(around * 3.0 + treeOwn.z * 6.2832 + shape.y * 6.0);
  shape.xz *= mix(1.0, mix(tier, lobes, treeFate.z), leafy) * mix(0.72, 1.3, treeOwn.x);
  shape.y *= mix(0.82, 1.22, treeOwn.y);
  vec2 lean = vec2(cos(treeOwn.y * 6.2832), sin(treeOwn.y * 6.2832));
  shape.xz += lean * shape.y * shape.y * (treeOwn.z - 0.3) * 0.14;
  transformed = ground - up * size * 0.08 + frame * (shape * size);
`

export function treeMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainMorphLod = TERRAIN_MORPH
    shader.uniforms.treeNormalMatrix = DETAIL_NORMAL_MATRIX
    shader.uniforms.detailMoons = DETAIL_MOONS
    shader.uniforms.treeSun = DETAIL_CLOUD_SUN
    shader.uniforms.detailSeason = DETAIL_SEASON
    withTownGlow(shader.uniforms)
    shader.vertexShader = (TREE_VERTEX + LEAF_SEASON_GLSL + shader.vertexShader)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        {
          vec3 up0 = normalize(mix(treeFine, treeCoarse, treeMorph()));
          objectNormal = treeFrame(up0, treeWood.x * 40.0) * normalize(mix(objectNormal, broadleafNormal, treeFate.z));
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        ${TREE_PLACE}
        float packed = treeLook.y;
        vTreeTint = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
        // A broadleaf through the year (leaves.ts), and a conifer in four
        // that is a larch: the temperate woods here are mostly conifer, and
        // with the broadleaves alone a whole autumn turned a tree in ten.
        float turns = max(treeFate.z, step(0.75, fract(treeWood.x * 7.31)) * 0.9);
        vTreeTint = mix(vTreeTint, leafColour(vTreeTint, leafSeason(up, treeWood.x), treeWood.x), turns);
        // No two trees quite one green, and no crown one flat colour: a
        // shift of hue each, a mottle across the leaves, and the tops
        // catching a warmer light than the shade beneath.
        vTreeTint *= vec3(mix(0.86, 1.14, treeOwn.x), 1.0, mix(0.82, 1.1, treeOwn.z));
        vTreeTint *= 0.84 + 0.32 * fract(sin(dot(position, vec3(12.9898, 78.233, 37.719)) + treeWood.x * 91.0) * 43758.5453);
        vTreeTint *= mix(vec3(0.92, 0.96, 1.0), vec3(1.08, 1.05, 0.86), smoothstep(0.45, 1.0, position.y));
        vTreeHeight = position.y;
        vTreeUp = normalize(normalMatrix * up);
        vTreePlanet = transformed;`,
      )
    shader.fragmentShader =
      'varying vec3 vTreeTint;\nvarying float vTreeHeight;\nvarying vec3 vTreeUp;\nvarying vec3 vTreePlanet;\nuniform vec4 detailMoons[2];\nuniform vec3 treeSun;\n' +
      MOON_SHADOW +
      TOWN_GLOW_GLSL +
      shader.fragmentShader
        .replace(
          '#include <emissivemap_fragment>',
          // The towns' light at night falls on the woods round them too (town-glow.ts).
          '#include <emissivemap_fragment>\n        totalEmissiveRadiance += diffuseColor.rgb * townGlowAt(vTreePlanet) * 0.7;',
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
        // The model is white where the tint shows and dark at the trunk; a
        // crown is darker underneath, which is most of what makes it solid.
        diffuseColor.rgb *= mix(vec3(1.0), vTreeTint, step(0.5, diffuseColor.g));
        diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.0, 0.9, vTreeHeight);`,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
        // The sky's light in the shade, less its blue: a wood's shaded side
        // read as a blue wall against green ground.
        reflectedLight.indirectDiffuse = mix(
          reflectedLight.indirectDiffuse,
          vec3(dot(reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114))),
          0.65
        );
        // No sun past the terminator, as for the ground.
        #if NUM_DIR_LIGHTS > 0
        {
          float treeDay = smoothstep(-0.05, 0.08, dot(normalize(vTreeUp), directionalLights[0].direction));
          // In an eclipse's shadow with the ground under them (eclipse.ts).
          treeDay *= 1.0 - moonShadowFrom(vTreePlanet, treeSun);
          reflectedLight.directDiffuse *= treeDay;
          reflectedLight.directSpecular *= treeDay;
        }
        #endif`,
        )
    // The depth is the ground's: up a tree there is that much less mist over it.
    withValleyFog(shader, 'treeMist', 'treeMist - (length(transformed) - length(ground))')
  }
  material.customProgramCacheKey = () => 'planet-trees'
  return material
}

/** The trees' shadow caster, placed exactly as they are drawn. */
export function treeDepthMaterial(): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainMorphLod = TERRAIN_MORPH
    shader.vertexShader = (TREE_VERTEX + shader.vertexShader).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${TREE_PLACE}`,
    )
  }
  material.customProgramCacheKey = () => 'planet-trees-depth'
  return material
}
