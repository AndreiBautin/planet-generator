import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { FEATURES, type Feature } from '@/generation/features'

import { STRIDE, type Scatter } from './scatter'

/**
 * The features as low-poly models, one shape per kind, drawn as instances: a
 * thousand trees in a wood are a handful of draw calls. Each instance stands
 * up from the ground, turned and sized as the scatterer decided, and tinted
 * its own colour — the models are white where the instance colour should
 * show and dark where a trunk is.
 *
 * Faceted on purpose: flat-shaded low-poly reads as a tree, a boulder or a
 * floe at a glance from the air, where a smooth blob reads as a ball.
 */

/** How tall a feature of size 1 stands, in planet radii. */
export const FEATURE_HEIGHT = 0.0011

const TRUNK = new THREE.Color(0.32, 0.24, 0.17)
const WHITE = new THREE.Color(1, 1, 1)

function painted(geometry: THREE.BufferGeometry, colour: THREE.Color): THREE.BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed()
  const count = flat.getAttribute('position').count
  const colours = new Float32Array(count * 3)
  for (let at = 0; at < count; at += 1) {
    colours[at * 3] = colour.r
    colours[at * 3 + 1] = colour.g
    colours[at * 3 + 2] = colour.b
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  flat.deleteAttribute('uv')
  return flat
}

function merged(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries([...parts])
  geometry.computeVertexNormals()
  return geometry
}

/** Each kind's model, standing on its origin with up along +y, a unit tall. */
function modelOf(feature: Feature): THREE.BufferGeometry {
  switch (feature) {
    case 'conifer':
      return merged([
        painted(new THREE.CylinderGeometry(0.05, 0.07, 0.25, 5).translate(0, 0.125, 0), TRUNK),
        painted(new THREE.ConeGeometry(0.34, 0.55, 7).translate(0, 0.42, 0), WHITE),
        painted(new THREE.ConeGeometry(0.25, 0.45, 7).translate(0, 0.72, 0), WHITE),
      ])
    case 'broadleaf':
      return merged([
        painted(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5).translate(0, 0.2, 0), TRUNK),
        painted(
          new THREE.IcosahedronGeometry(0.36, 0).scale(1, 0.85, 1).translate(0, 0.62, 0),
          WHITE,
        ),
        painted(new THREE.IcosahedronGeometry(0.24, 0).translate(0.18, 0.5, 0.1), WHITE),
      ])
    case 'shrub':
      return merged([
        painted(
          new THREE.IcosahedronGeometry(0.3, 0).scale(1.2, 0.7, 1).translate(0, 0.15, 0),
          WHITE,
        ),
        painted(new THREE.IcosahedronGeometry(0.2, 0).translate(0.22, 0.12, -0.08), WHITE),
      ])
    case 'cactus':
      return merged([
        painted(new THREE.CylinderGeometry(0.09, 0.1, 0.8, 6).translate(0, 0.4, 0), WHITE),
        painted(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 6).translate(0.15, 0.48, 0), WHITE),
        painted(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 6).translate(-0.14, 0.38, 0), WHITE),
      ])
    case 'rock':
      return merged([
        painted(
          new THREE.DodecahedronGeometry(0.32, 0).scale(1.2, 0.65, 1).translate(0, 0.1, 0),
          WHITE,
        ),
      ])
    case 'boulder':
      // Two lumps leaning together, so a boulder is not a stretched rock.
      return merged([
        painted(
          new THREE.DodecahedronGeometry(0.34, 0).scale(1.1, 0.8, 1).translate(0, 0.15, 0),
          WHITE,
        ),
        painted(
          new THREE.IcosahedronGeometry(0.22, 0).scale(1, 0.75, 1).translate(0.27, 0.06, 0.12),
          WHITE,
        ),
      ])
    case 'spire':
      // Columns of three heights: basalt organ pipes, or a serac of ice.
      return merged([
        painted(new THREE.CylinderGeometry(0.11, 0.13, 1, 6).translate(0, 0.5, 0), WHITE),
        painted(new THREE.CylinderGeometry(0.1, 0.12, 0.72, 6).translate(0.2, 0.36, 0.07), WHITE),
        painted(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 6).translate(-0.1, 0.25, 0.19), WHITE),
      ])
    case 'floe':
      // A flat plate of ice with a broken edge, riding just proud of the sea.
      return merged([
        painted(
          new THREE.CylinderGeometry(0.5, 0.46, 0.05, 7).scale(1, 1, 0.75).translate(0, 0.01, 0),
          WHITE,
        ),
        painted(new THREE.CylinderGeometry(0.22, 0.2, 0.04, 5).translate(0.42, 0.005, 0.18), WHITE),
      ])
  }
}

const models = new Map<Feature, THREE.BufferGeometry>()
const model = (feature: Feature): THREE.BufferGeometry => {
  const known = models.get(feature)
  if (known !== undefined) return known
  const made = modelOf(feature)
  models.set(feature, made)
  return made
}

export function featureMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.88,
    metalness: 0,
  })
}

const up = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)
const stand = new THREE.Quaternion()
const twist = new THREE.Quaternion()
const where = new THREE.Vector3()
const size = new THREE.Vector3()
const matrix = new THREE.Matrix4()
const tint = new THREE.Color()

/** The instanced meshes for a tile's features: one per kind present. */
export function featuresFor(scatter: Scatter, material: THREE.Material): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = []
  for (const feature of FEATURES) {
    const data = scatter[feature]
    if (data === undefined) continue
    const count = data.length / STRIDE
    const mesh = new THREE.InstancedMesh(model(feature), material, count)
    for (let at = 0; at < count; at += 1) {
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
      mesh.setMatrixAt(at, matrix)
      mesh.setColorAt(at, tint.setRGB(data[o + 5] ?? 1, data[o + 6] ?? 1, data[o + 7] ?? 1))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    meshes.push(mesh)
  }
  return meshes
}
