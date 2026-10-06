import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { DETAIL_NORMAL_MATRIX, TERRAIN_MORPH } from '../detail'
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

function painted(geometry: THREE.BufferGeometry, colour: THREE.Color): THREE.BufferGeometry {
  const plain = geometry
  const count = plain.getAttribute('position').count
  const colours = new Float32Array(count * 3)
  for (let k = 0; k < count; k += 1) {
    colours[k * 3] = colour.r
    colours[k * 3 + 1] = colour.g
    colours[k * 3 + 2] = colour.b
  }
  plain.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  plain.deleteAttribute('uv')
  // Normals are found once the parts are merged, the same way for every part.
  plain.deleteAttribute('normal')
  return plain
}

/** A conifer: three stacked cones on a short trunk. Few faces, as a tree a few pixels tall needs. */
function conifer(): THREE.BufferGeometry {
  const parts = [
    painted(new THREE.CylinderGeometry(0.04, 0.06, 0.25, 5, 1, true).translate(0, 0.125, 0), TRUNK),
    // Closed cones, drawn one-sided: open ones showed their dark insides as shards.
    painted(new THREE.ConeGeometry(0.34, 0.42, 7).translate(0, 0.42, 0), LEAF),
    painted(new THREE.ConeGeometry(0.26, 0.38, 7).translate(0, 0.66, 0), LEAF),
    painted(new THREE.ConeGeometry(0.16, 0.32, 7).translate(0, 0.88, 0), LEAF),
  ]
  const merged = mergeGeometries(parts)
  merged.computeVertexNormals()
  return merged
}

/** A broadleaf: a rounded crown, a little lumpy, on a trunk. */
function broadleaf(): THREE.BufferGeometry {
  // Indexed, as the trunk is: the two are merged into one model.
  const crown = mergeVertices(
    new THREE.IcosahedronGeometry(0.36, 0).deleteAttribute('normal').deleteAttribute('uv'),
  )
  const positions = crown.getAttribute('position')
  for (let k = 0; k < positions.count; k += 1) {
    const x = positions.getX(k)
    const y = positions.getY(k)
    const z = positions.getZ(k)
    const bump = 1 + 0.12 * Math.sin(x * 23 + y * 17) * Math.cos(z * 19 - y * 11)
    positions.setXYZ(k, x * bump, y * bump * 0.85, z * bump)
  }
  const second = crown.clone().scale(0.75, 0.75, 0.75).rotateY(1.1)
  const parts = [
    painted(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5, 1, true).translate(0, 0.2, 0), TRUNK),
    painted(crown.translate(0, 0.62, 0), LEAF),
    // A second, smaller lump to one side, so a crown is not one gem.
    painted(second.translate(0.2, 0.52, 0.1), LEAF),
  ]
  const merged = mergeGeometries(parts)
  merged.computeVertexNormals()
  return merged
}

const MODELS = { conifer: conifer(), broadleaf: broadleaf() } as const

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
const STRIDE = 13

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
  const found = { conifer: [] as number[], broadleaf: [] as number[] }
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
      found[kind].push(
        x,
        y,
        z,
        patch.coarsePositions[v * 4] ?? x,
        patch.coarsePositions[v * 4 + 1] ?? y,
        patch.coarsePositions[v * 4 + 2] ?? z,
        level,
        shared ? 1 : 0,
        chance,
        fine,
        coarse,
        (0.6 + roll * 0.8) * scale,
        // The colour packed into one float, three bytes' worth of shade.
        Math.floor(Math.min(1, tint.r * shade) * 255) * 65536 +
          Math.floor(Math.min(1, tint.g * shade) * 255) * 256 +
          Math.floor(Math.min(1, tint.b * shade) * 255),
      )
    }
  }
  const bounds = new THREE.Box3()
    .setFromBufferAttribute(
      new THREE.BufferAttribute(patch.positions.subarray(0, side * side * 3), 3),
    )
    .getBoundingSphere(new THREE.Sphere())
  bounds.radius += TREE_HEIGHT * 1.5 * scale * 2
  const meshes: THREE.Mesh[] = []
  for (const kind of ['conifer', 'broadleaf'] as const) {
    const data = found[kind]
    const count = data.length / STRIDE
    if (count === 0) continue
    const model = MODELS[kind]
    const geometry = new THREE.InstancedBufferGeometry()
    for (const [name, attribute] of Object.entries(model.attributes))
      geometry.setAttribute(name, attribute)
    geometry.setIndex(model.index)
    const buffer = new THREE.InstancedInterleavedBuffer(Float32Array.from(data), STRIDE, 1)
    geometry.setAttribute('treeFine', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
    geometry.setAttribute('treeCoarse', new THREE.InterleavedBufferAttribute(buffer, 3, 3))
    geometry.setAttribute('treeFate', new THREE.InterleavedBufferAttribute(buffer, 2, 6))
    geometry.setAttribute('treeWood', new THREE.InterleavedBufferAttribute(buffer, 3, 8))
    geometry.setAttribute('treeLook', new THREE.InterleavedBufferAttribute(buffer, 2, 11))
    geometry.instanceCount = count
    // Culled by the patch's own bounds, grown by the tallest a tree here
    // can stand: the model's own bounds know nothing of where instances go.
    geometry.boundingSphere = bounds.clone()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.customDepthMaterial = depth
    meshes.push(mesh)
  }
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
attribute vec2 treeFate;
attribute vec3 treeWood;
attribute vec2 treeLook;
varying vec3 vTreeTint;
varying float vTreeHeight;
varying vec3 vTreeUp;
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
  transformed = ground - up * size * 0.08 + frame * (position * size);
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
    shader.vertexShader = (TREE_VERTEX + shader.vertexShader)
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        {
          vec3 up0 = normalize(mix(treeFine, treeCoarse, treeMorph()));
          objectNormal = treeFrame(up0, treeWood.x * 40.0) * objectNormal;
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        ${TREE_PLACE}
        float packed = treeLook.y;
        vTreeTint = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
        vTreeHeight = position.y;
        vTreeUp = normalize(normalMatrix * up);`,
      )
    shader.fragmentShader =
      'varying vec3 vTreeTint;\nvarying float vTreeHeight;\nvarying vec3 vTreeUp;\n' +
      shader.fragmentShader
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
        // No sun past the terminator, as for the ground.
        #if NUM_DIR_LIGHTS > 0
        {
          float treeDay = smoothstep(-0.05, 0.08, dot(normalize(vTreeUp), directionalLights[0].direction));
          reflectedLight.directDiffuse *= treeDay;
          reflectedLight.directSpecular *= treeDay;
        }
        #endif`,
        )
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
