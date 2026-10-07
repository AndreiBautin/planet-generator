import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import type { Planet } from '@/generation/planet'
import type { Ruin } from '@/generation/ruins'

import { groundRadiusAt } from './patches/patch-data'
import { drawOnlyLive } from './instances'
import { weather } from './weathered'

/** Ruins built at once: those within reach of the eye. */
const MOST_RUINS = 12
/** Stones in a ruin at most. */
const PIECES = 32
/** Ruins within this of the eye are built, in radians; they shrink away over the last stretch. */
const NEAR = 0.05
const SHRINK_FROM = 0.036
/** Above this height there are no ruins to look for. */
const HIGHEST_EYE = 0.08

/** A temple's ring of columns, its radius, and a column's full height, in radii. */
const RING = 0.00048
const COLUMN = 0.00062
/** A fort's walls, half a side, and their full height. */
const WALL = 0.0007
const WALL_HIGH = 0.00034

/**
 * Ruins: the stones of whoever was here before, on the hilltops
 * (generation/ruins.ts, found in the build worker) — a ring of columns
 * standing at broken heights round a platform with drums fallen among
 * them, or the stumps of a fort's four walls, gapped, with its corner
 * towers. Pale weathered stone, lit by the scene.
 *
 * Built only for the ruins near the eye, a stone at a time where the
 * ground was measured for it, into a fixed number of slots each holding
 * its ruin while near; shrinking away at the edge of that reach rather than
 * vanishing, as the herds do.
 */
export class Ruins {
  readonly group = new THREE.Group()
  private readonly blocks: THREE.InstancedMesh
  private readonly columns: THREE.InstancedMesh
  // Filled, not just sized: `indexOf(undefined)` skips the holes of a
  // sized array, so no ruin ever found a free slot.
  private readonly slots: (number | undefined)[] = new Array<number | undefined>(MOST_RUINS).fill(
    undefined,
  )
  /** Per slot: the stones' resting matrices before shrinking, blocks then columns. */
  private readonly placed: { blocks: THREE.Matrix4[]; columns: THREE.Matrix4[]; at: Vec3 }[] = []
  private readonly ruins: readonly Ruin[]
  private readonly world: Planet
  private readonly matrix = new THREE.Matrix4()
  private readonly shrink = new THREE.Matrix4()
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)
  private lastEye = new THREE.Vector3(2, 2, 2)

  constructor(ruins: readonly Ruin[], world: Planet) {
    this.ruins = ruins
    this.world = world
    const stone = new THREE.MeshStandardMaterial({ roughness: 0.95 })
    // Old stone: no block cut true, patched with age, moss on what faces
    // up and dark at the foot; its own pallor a little light by day, since
    // lit by the scene alone a column's dark side was black (weathered.ts).
    weather(stone, {
      rough: 0.1,
      mottle: 0.3,
      grain: 14000,
      top: { colour: [0.24, 0.34, 0.12], amount: 0.9 },
      foot: { dark: 0.3, height: 0.25 },
      own: 0.18,
    })
    const count = MOST_RUINS * PIECES
    this.blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      stone,
      count,
    )
    this.columns = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.42, 0.5, 1, 8).translate(0, 0.5, 0),
      stone,
      count,
    )
    const colour = new THREE.Color()
    for (const mesh of [this.blocks, this.columns]) {
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      for (let k = 0; k < count; k += 1) {
        mesh.setMatrixAt(k, this.gone)
        // Pale stone, each a little different: weathered unevenly.
        const shade = 0.62 + 0.18 * hash(k * 7 + (mesh === this.blocks ? 0 : 3))
        mesh.setColorAt(k, colour.setRGB(shade, shade * 0.96, shade * 0.88))
      }
      this.group.add(mesh)
    }
    for (let k = 0; k < MOST_RUINS; k += 1)
      this.placed.push({ blocks: [], columns: [], at: [0, 0, 1] })
  }

  /** Follow the eye, in the planet's own frame and in radii. */
  update(eye: Vec3): void {
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    this.group.visible = length - 1 < HIGHEST_EYE && this.ruins.length > 0
    if (!this.group.visible) return
    const under: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
    // Which ruins are near only changes as the eye moves; look again once it
    // has gone a little way.
    if (this.lastEye.distanceTo(new THREE.Vector3(...under)) > 0.004) {
      this.lastEye.set(...under)
      this.gather(under)
    }
    this.placed.forEach((slot, s) => {
      const held = this.slots[s]
      const away =
        held === undefined
          ? Math.PI
          : Math.acos(
              Math.min(1, slot.at[0] * under[0] + slot.at[1] * under[1] + slot.at[2] * under[2]),
            )
      const shown = held === undefined ? 0 : 1 - smooth(SHRINK_FROM, NEAR, away)
      for (const [mesh, list] of [
        [this.blocks, slot.blocks],
        [this.columns, slot.columns],
      ] as const) {
        for (let k = 0; k < PIECES; k += 1) {
          const at = s * PIECES + k
          const rest = list[k]
          if (rest === undefined || shown <= 0) {
            mesh.setMatrixAt(at, this.gone)
            continue
          }
          // Shrunk towards its own foot, so a stone sinks rather than floats.
          this.shrink.makeScale(shown, shown, shown)
          this.matrix.copy(rest).multiply(this.shrink)
          mesh.setMatrixAt(at, this.matrix)
        }
      }
    })
    this.blocks.instanceMatrix.needsUpdate = true
    this.columns.instanceMatrix.needsUpdate = true
    drawOnlyLive(this.blocks)
    drawOnlyLive(this.columns)
  }

  /** Hold the ruins within reach in slots, keeping each where it was. */
  private gather(under: Vec3): void {
    const reach = Math.cos(NEAR)
    const wanted = new Set<number>()
    this.ruins.forEach((ruin, k) => {
      if (ruin.at[0] * under[0] + ruin.at[1] * under[1] + ruin.at[2] * under[2] > reach)
        wanted.add(k)
    })
    this.slots.forEach((held, s) => {
      if (held !== undefined && !wanted.has(held)) this.slots[s] = undefined
    })
    for (const k of wanted) {
      if (this.slots.includes(k)) continue
      const free = this.slots.indexOf(undefined)
      if (free < 0) break
      const ruin = this.ruins[k]
      const slot = this.placed[free]
      if (ruin === undefined || slot === undefined) continue
      this.slots[free] = k
      this.build(ruin, slot)
    }
  }

  /** Lay a ruin's stones, each on the ground where it stands. */
  private build(
    ruin: Ruin,
    slot: { blocks: THREE.Matrix4[]; columns: THREE.Matrix4[]; at: Vec3 },
  ): void {
    slot.at = ruin.at
    slot.blocks = []
    slot.columns = []
    let h = Math.floor(ruin.seed * 4294967296) | 1
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    const up = new THREE.Vector3(...ruin.at)
    const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up)
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0)
    east.normalize()
    const north = new THREE.Vector3().crossVectors(up, east)
    const facing = ruin.seed * Math.PI * 2
    // A stone at (x, z) in the ruin's own plan, in radii, turned by `turn`
    // and sized `size` (x across, y up, z along), sunk a little into the ground.
    const stone = (
      list: THREE.Matrix4[],
      x: number,
      z: number,
      turn: number,
      size: THREE.Vector3,
      tilt = 0,
    ): void => {
      if (list.length >= PIECES) return
      const c = Math.cos(facing)
      const s = Math.sin(facing)
      const px = x * c - z * s
      const pz = x * s + z * c
      const direction = up.clone().addScaledVector(east, px).addScaledVector(north, pz).normalize()
      const radius = groundRadiusAt(this.world, [direction.x, direction.y, direction.z]) - 0.00004
      const along = east
        .clone()
        .multiplyScalar(Math.cos(facing + turn))
        .addScaledVector(north, Math.sin(facing + turn))
      const across = new THREE.Vector3().crossVectors(direction, along).normalize()
      along.crossVectors(across, direction).normalize()
      const basis = new THREE.Matrix4().makeBasis(across, direction, along)
      const turnQ = new THREE.Quaternion().setFromRotationMatrix(basis)
      if (tilt !== 0)
        turnQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt))
      list.push(new THREE.Matrix4().compose(direction.multiplyScalar(radius), turnQ, size))
    }
    if (ruin.kind === 0) {
      // The platform, two steps.
      stone(slot.blocks, 0, 0, 0, new THREE.Vector3(RING * 2.5, 0.00006, RING * 2.5))
      stone(slot.blocks, 0, 0, 0, new THREE.Vector3(RING * 2.2, 0.00011, RING * 2.2))
      // A ring of twelve columns, some standing whole, most broken, some gone.
      for (let k = 0; k < 12; k += 1) {
        const a = (k / 12) * Math.PI * 2
        const fate = next()
        if (fate < 0.2) continue
        const high = COLUMN * (fate > 0.75 ? 1 : 0.25 + 0.6 * next())
        stone(
          slot.columns,
          Math.cos(a) * RING,
          Math.sin(a) * RING,
          0,
          new THREE.Vector3(0.00009, high, 0.00009),
        )
        // A lintel still across two whole columns, now and then.
        if (fate > 0.75 && next() < 0.5)
          stone(
            slot.blocks,
            Math.cos(a + 0.26) * RING * 0.97,
            Math.sin(a + 0.26) * RING * 0.97,
            a + 0.26 + Math.PI / 2,
            new THREE.Vector3(0.00008, 0.00007, RING * 0.55),
          )
      }
      // Drums fallen among them, lying on their sides.
      for (let k = 0; k < 5; k += 1) {
        const a = next() * Math.PI * 2
        const r = RING * (0.6 + 0.9 * next())
        stone(
          slot.columns,
          Math.cos(a) * r,
          Math.sin(a) * r,
          next() * Math.PI,
          new THREE.Vector3(0.00009, 0.00016, 0.00009),
          Math.PI / 2,
        )
      }
    } else {
      // Four walls, each in three stretches at broken heights, some fallen.
      for (let side = 0; side < 4; side += 1) {
        const a = (side / 4) * Math.PI * 2
        for (let k = -1; k <= 1; k += 1) {
          if (next() < 0.25) continue
          const along = (k * WALL * 2) / 3
          const x = Math.cos(a) * WALL - Math.sin(a) * along
          const z = Math.sin(a) * WALL + Math.cos(a) * along
          const high = WALL_HIGH * (0.25 + 0.75 * next())
          stone(
            slot.blocks,
            x,
            z,
            a + Math.PI / 2,
            new THREE.Vector3(0.00008, high, (WALL * 2) / 3.3),
          )
        }
        // A corner tower's stump.
        const c = a + Math.PI / 4
        stone(
          slot.columns,
          Math.cos(c) * WALL * 1.41,
          Math.sin(c) * WALL * 1.41,
          0,
          new THREE.Vector3(0.00026, WALL_HIGH * (0.6 + 0.8 * next()), 0.00026),
        )
      }
      // Tumbled blocks inside and out.
      for (let k = 0; k < 6; k += 1) {
        const a = next() * Math.PI * 2
        const r = WALL * (0.3 + 1.2 * next())
        stone(
          slot.blocks,
          Math.cos(a) * r,
          Math.sin(a) * r,
          next() * Math.PI,
          new THREE.Vector3(0.00008, 0.00006, 0.00011),
          (next() - 0.5) * 0.6,
        )
      }
    }
  }
}

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** A fixed roll, 0 to 1, for a number. */
function hash(n: number): number {
  let h = Math.imul(n + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}
