import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { herdIn, MOST_BEASTS, type Herd } from '@/generation/herds'
import { cellOf } from '@/generation/hydrology'
import type { Planet } from '@/generation/planet'

import { NearCells } from './near-cells'
import { groundRadiusAt } from './patches/patch-data'
import { SEA_RADIUS } from './water'
import { weather } from './weathered'

/** The most herds drawn at once: two rings of cells round the eye's hold about a quarter of this. */
const MOST_HERDS = 32
/** How far off a beast is drawn, in radii; it shrinks away over the last third, where it is a few pixels. */
const SEEN = 0.016
/** Above this height, in radii, there are no herds to look for. */
const HIGHEST_EYE = 0.04
/**
 * A beast nose to tail, in radii: larger than life, as the birds and the
 * trees are. At 0.00013 a herd under a glide was a scatter of specks
 * beside trees ten times its height.
 */
const LENGTH = 0.0002
/** How far a herd spreads round its middle. */
const SPREAD = 0.0011
/** Steeper than this (rise over run between two points a beast apart) and none stands there. */
const STEEPEST = 0.35

/** Tawny, brown and dark, by kind (generation/herds.ts). */
const COATS = [new THREE.Color(0xc29a5c), new THREE.Color(0x6e4526), new THREE.Color(0x3b3431)]

/**
 * Herds: grazing animals on open grass near the eye (generation/herds.ts),
 * a PS1 beast of boxes — a body on four legs, and a head on a neck that
 * dips to graze and comes up to look round. Each stands where the ground
 * was measured for it once, turning slowly and shuffling a step or two,
 * so nothing needs the ground sampled again frame by frame.
 *
 * Instanced meshes in the scene's own light and fog, rather than a shader
 * of their own: a herd stands on the ground and must be lit and hazed
 * exactly as the ground round it is. Kept to the cells round the eye by
 * `NearCells`, as the birds and fish are.
 */
export class Herds {
  readonly object = new THREE.Group()
  private readonly bodies: THREE.InstancedMesh
  private readonly heads: THREE.InstancedMesh
  /** Per beast: where (a unit direction), the ground's radius there, a heading, a seed, whether it stands. */
  private readonly beasts = new Float32Array(MOST_HERDS * MOST_BEASTS * 7)
  private readonly near = new NearCells<Herd>(
    MOST_HERDS,
    (cell) => (this.world === undefined ? undefined : herdIn(this.world, cell)),
    (slot, cell, herd) => {
      this.fill(slot, cell, herd)
    },
    (slot) => {
      this.clear(slot)
    },
  )
  private world: Planet | undefined
  private readonly body = new THREE.Matrix4()
  private readonly pivot = new THREE.Matrix4()
  private readonly nod = new THREE.Matrix4()
  private readonly basis = new THREE.Matrix4()
  private readonly turn = new THREE.Quaternion()
  private readonly at = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly east = new THREE.Vector3()
  private readonly north = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly size = new THREE.Vector3()
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)
  private static readonly Y = new THREE.Vector3(0, 1, 0)
  private static readonly X = new THREE.Vector3(1, 0, 0)

  constructor() {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.95 })
    // Their own coat as a little light of its own: lit by the scene alone,
    // the flanks away from a high sun went black, a herd of silhouettes on
    // ground the terrain shader lights more kindly.
    // And a coat patched rather than flat, each beast its own (weathered.ts).
    weather(material, { rough: 0, mottle: 0.35, grain: 40000, own: 0.22 })
    const count = MOST_HERDS * MOST_BEASTS
    this.bodies = new THREE.InstancedMesh(bodyGeometry(), material, count)
    this.heads = new THREE.InstancedMesh(headGeometry(), material, count)
    for (const mesh of [this.bodies, this.heads]) {
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      for (let k = 0; k < count; k += 1) {
        mesh.setMatrixAt(k, this.gone)
        mesh.setColorAt(k, COATS[1] ?? new THREE.Color())
      }
      this.object.add(mesh)
    }
    this.object.matrixAutoUpdate = false
    this.object.visible = false
  }

  /** A new world: its own herds, none of the last one's. */
  setWorld(world: Planet): void {
    this.world = world
    this.near.reset()
    this.beasts.fill(0)
  }

  /**
   * Follow the eye: `eye` in the planet's own frame, in radii; `ground` the
   * planet's matrix; `seconds` the shared clock.
   */
  update(eye: Vec3, ground: THREE.Matrix4, seconds: number): void {
    const length = Math.hypot(eye[0], eye[1], eye[2])
    this.object.visible = this.world !== undefined && !this.world.molten && length - 1 < HIGHEST_EYE
    if (!this.object.visible) return
    this.object.matrix.copy(ground)
    this.object.matrixWorld.copy(ground)
    this.object.updateMatrixWorld(true)
    this.near.near(cellOf(eye))
    const b = this.beasts
    for (let k = 0; k < MOST_HERDS * MOST_BEASTS; k += 1) {
      const o = k * 7
      if ((b[o + 6] ?? 0) < 0.5) {
        this.bodies.setMatrixAt(k, this.gone)
        this.heads.setMatrixAt(k, this.gone)
        continue
      }
      this.at.set(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 1)
      const away = Math.hypot(this.at.x - eye[0], this.at.y - eye[1], this.at.z - eye[2])
      const shown = 1 - smooth(SEEN * 0.65, SEEN, away)
      if (shown <= 0) {
        this.bodies.setMatrixAt(k, this.gone)
        this.heads.setMatrixAt(k, this.gone)
        continue
      }
      const seed = b[o + 5] ?? 0
      // Turning slowly as it grazes, and a step forward and back.
      const heading = (b[o + 4] ?? 0) + 0.5 * Math.sin(seconds * 0.06 + seed * 40)
      this.up.copy(this.at)
      this.east.crossVectors(Herds.Y, this.up)
      if (this.east.lengthSq() < 1e-8) this.east.crossVectors(Herds.X, this.up)
      this.east.normalize()
      this.north.crossVectors(this.up, this.east)
      this.forward
        .copy(this.east)
        .multiplyScalar(Math.cos(heading))
        .addScaledVector(this.north, Math.sin(heading))
      this.side.crossVectors(this.up, this.forward)
      const step = Math.sin(seconds * 0.05 + seed * 17) * LENGTH * 0.6
      this.at.multiplyScalar(b[o + 3] ?? 1).addScaledVector(this.forward, step)
      this.basis.makeBasis(this.side, this.up, this.forward)
      this.turn.setFromRotationMatrix(this.basis)
      const size = LENGTH * (0.85 + 0.3 * seed) * shown
      this.size.setScalar(size)
      this.body.compose(this.at, this.turn, this.size)
      this.bodies.setMatrixAt(k, this.body)
      // Head down to graze most of the time, up now and then to look round.
      const grazing = smooth(-0.35, 0.35, Math.sin(seconds * 0.35 + seed * 31))
      const pitch = -0.25 + 1.25 * grazing
      this.pivot.makeTranslation(0, 0.78, 0.42)
      this.nod.makeRotationAxis(Herds.X, pitch)
      this.body.multiply(this.pivot).multiply(this.nod)
      this.heads.setMatrixAt(k, this.body)
    }
    this.bodies.instanceMatrix.needsUpdate = true
    this.heads.instanceMatrix.needsUpdate = true
  }

  private fill(slot: number, cell: number, herd: Herd): void {
    const world = this.world
    if (world === undefined) return
    let h = Math.imul(cell + 7, 0x9e3779b1)
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    // A herd mostly faces one way, give or take.
    const facing = herd.seed * Math.PI * 2
    const coat = COATS[herd.kind] ?? COATS[1] ?? new THREE.Color()
    const colour = new THREE.Color()
    for (let k = 0; k < MOST_BEASTS; k += 1) {
      const at = slot * MOST_BEASTS + k
      const o = at * 7
      const r = SPREAD * Math.sqrt(next())
      const direction = around(herd.at, r, next() * Math.PI * 2)
      const radius = groundRadiusAt(world, direction)
      // Not in the water, and not on a slope a beast could not stand on:
      // the ground a beast's length ahead must be near level with here.
      const ahead = around(direction, LENGTH * 2, facing)
      const rise = Math.abs(groundRadiusAt(world, ahead) - radius) / (LENGTH * 2)
      const stands = k < herd.beasts && radius > SEA_RADIUS + 0.0002 && rise < STEEPEST
      this.beasts[o] = direction[0]
      this.beasts[o + 1] = direction[1]
      this.beasts[o + 2] = direction[2]
      this.beasts[o + 3] = radius
      this.beasts[o + 4] = facing + (next() - 0.5) * 1.6
      this.beasts[o + 5] = next()
      this.beasts[o + 6] = stands ? 1 : 0
      colour.copy(coat).multiplyScalar(0.8 + 0.4 * next())
      this.bodies.setColorAt(at, colour)
      this.heads.setColorAt(at, colour)
    }
    if (this.bodies.instanceColor !== null) this.bodies.instanceColor.needsUpdate = true
    if (this.heads.instanceColor !== null) this.heads.instanceColor.needsUpdate = true
  }

  private clear(slot: number): void {
    for (let k = 0; k < MOST_BEASTS; k += 1) this.beasts[(slot * MOST_BEASTS + k) * 7 + 6] = 0
  }

  dispose(): void {
    this.bodies.geometry.dispose()
    this.heads.geometry.dispose()
    const material: unknown = this.bodies.material
    if (material instanceof THREE.Material) material.dispose()
  }
}

/** Boxes merged into one geometry: each `[x, y, z, width, height, depth]`, centred. */
function boxes(
  parts: readonly (readonly [number, number, number, number, number, number])[],
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const index: number[] = []
  for (const [x, y, z, w, hgt, d] of parts) {
    const box = new THREE.BoxGeometry(w, hgt, d).translate(x, y, z)
    const p = box.getAttribute('position')
    const n = box.getAttribute('normal')
    const base = positions.length / 3
    for (let k = 0; k < p.count; k += 1) {
      positions.push(p.getX(k), p.getY(k), p.getZ(k))
      normals.push(n.getX(k), n.getY(k), n.getZ(k))
    }
    const i = box.getIndex()
    if (i !== null) for (let k = 0; k < i.count; k += 1) index.push(base + i.getX(k))
    box.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(index)
  return geometry
}

/** A body on four legs, a beast's length long along z, standing on y = 0. */
function bodyGeometry(): THREE.BufferGeometry {
  return boxes([
    [0, 0.68, 0, 0.36, 0.34, 0.86],
    // A rump a little higher than the shoulders reads as a grazer, not a box.
    [0, 0.72, -0.3, 0.38, 0.3, 0.26],
    [-0.12, 0.26, 0.32, 0.08, 0.52, 0.08],
    [0.12, 0.26, 0.32, 0.08, 0.52, 0.08],
    [-0.12, 0.26, -0.32, 0.08, 0.52, 0.08],
    [0.12, 0.26, -0.32, 0.08, 0.52, 0.08],
    // The tail.
    [0, 0.62, -0.47, 0.05, 0.3, 0.05],
  ])
}

/** A neck and head from a pivot at the shoulders, reaching forward and down (rotated about x to graze). */
function headGeometry(): THREE.BufferGeometry {
  return boxes([
    [0, 0.08, 0.12, 0.16, 0.18, 0.3],
    [0, 0.0, 0.32, 0.15, 0.17, 0.24],
    // Ears or horns.
    [-0.08, 0.12, 0.26, 0.04, 0.1, 0.04],
    [0.08, 0.12, 0.26, 0.04, 0.1, 0.04],
  ])
}

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** A point `distance` radians from `centre`, at `bearing` round it. */
function around(centre: Vec3, distance: number, bearing: number): Vec3 {
  const helper: Vec3 = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit([
    helper[1] * centre[2] - helper[2] * centre[1],
    helper[2] * centre[0] - helper[0] * centre[2],
    helper[0] * centre[1] - helper[1] * centre[0],
  ])
  const e2: Vec3 = [
    centre[1] * e1[2] - centre[2] * e1[1],
    centre[2] * e1[0] - centre[0] * e1[2],
    centre[0] * e1[1] - centre[1] * e1[0],
  ]
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  const cb = Math.cos(bearing)
  const sb = Math.sin(bearing)
  return unit([
    centre[0] * c + (e1[0] * cb + e2[0] * sb) * s,
    centre[1] * c + (e1[1] * cb + e2[1] * sb) * s,
    centre[2] * c + (e1[2] * cb + e2[2] * sb) * s,
  ])
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
