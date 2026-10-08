import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import type { Harbours } from '@/generation/harbours'

import { swellHeaveAt } from './swell'
import { SEA_RADIUS } from './water'
import { weather } from './weathered'

/**
 * Harbours and ships (generation/harbours.ts): a pier out from each
 * coastal town, and ships — a hull and a white sail — going round the sea
 * lanes between harbours, each drawing a wake of foam behind it that fades
 * as it spreads. A child of the ground, so it turns with the planet; ships
 * move by the clock, the same for everyone who looks.
 *
 * Drawn only near the eye: a ship is a few hundredths of a radius long,
 * and from orbit would be a speck that sparkles as it moves.
 */

/** How fast a ship goes, radians a second. */
const SPEED = 0.0005
/** How near, in radians from the eye's ground point, ships are drawn. */
const SHIPS_NEAR = 0.06
/** Points in a wake, and how far apart, in radians. */
const WAKE_POINTS = 20
const WAKE_STEP = 0.00022
/** How far over the sea a ship's keel sits, so the swell does not swallow it. */
const RIDE = 0.00012

interface Ship {
  readonly lane: number
  /** Where round its lane it starts, as a share of the lane's length. */
  readonly offset: number
}

/** A closed loop of points with its running lengths, for finding a point a distance round it. */
interface Loop {
  readonly points: readonly Vec3[]
  readonly at: readonly number[]
  readonly length: number
}

export class Ships {
  readonly group = new THREE.Group()
  private readonly loops: Loop[]
  private readonly ships: Ship[] = []
  private readonly hulls: THREE.InstancedMesh
  private readonly wakePositions: Float32Array
  private readonly wakes: THREE.Mesh
  private readonly matrix = new THREE.Matrix4()
  private readonly turn = new THREE.Quaternion()
  private readonly basis = new THREE.Matrix4()
  private readonly place = new THREE.Vector3()
  private readonly size = new THREE.Vector3(1, 1, 1)
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)

  /** The water under a point of the sea (a unit direction), in radii; deep everywhere if not given. */
  private readonly depthAt: (at: Vec3) => number

  constructor(harbours: Harbours, depthAt: (at: Vec3) => number = () => Infinity) {
    this.depthAt = depthAt
    this.loops = harbours.lanes.map(loopOf)
    this.loops.forEach((loop, lane) => {
      const count = Math.min(3, Math.max(1, Math.round(loop.length / 0.04)))
      for (let k = 0; k < count; k += 1) this.ships.push({ lane, offset: k / count })
    })
    this.group.add(piers(harbours))
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
    })
    // Sea-worn planking, dark along the waterline (weathered.ts).
    weather(material, {
      rough: 0,
      mottle: 0.25,
      grain: 25000,
      foot: { dark: 0.3, height: 0.00012 },
      own: 0.15,
    })
    this.hulls = new THREE.InstancedMesh(shipGeometry(), material, Math.max(1, this.ships.length))
    this.hulls.frustumCulled = false
    this.group.add(this.hulls)
    // Each wake a strip of quads, two vertices a point.
    this.wakePositions = new Float32Array(Math.max(1, this.ships.length) * WAKE_POINTS * 2 * 3)
    const fade = new Float32Array(Math.max(1, this.ships.length) * WAKE_POINTS * 2)
    const across = new Float32Array(Math.max(1, this.ships.length) * WAKE_POINTS * 2)
    const index: number[] = []
    for (let s = 0; s < this.ships.length; s += 1) {
      for (let k = 0; k < WAKE_POINTS; k += 1) {
        const v = (s * WAKE_POINTS + k) * 2
        fade[v] = k / (WAKE_POINTS - 1)
        fade[v + 1] = k / (WAKE_POINTS - 1)
        across[v] = -1
        across[v + 1] = 1
        if (k + 1 < WAKE_POINTS) index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.wakePositions, 3))
    geometry.setAttribute('wake', new THREE.BufferAttribute(fade, 1))
    geometry.setAttribute('across', new THREE.BufferAttribute(across, 1))
    geometry.setIndex(index)
    this.wakes = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          attribute float wake;
          attribute float across;
          varying float vWake;
          varying float vAcross;
          void main() {
            vWake = wake;
            vAcross = across;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vWake;
          varying float vAcross;
          void main() {
            // A V of foam: two arms spreading from the stern, the churned
            // water between them fading first, all thinning to nothing behind.
            float edge = smoothstep(0.55, 0.95, abs(vAcross)) * (1.0 - smoothstep(0.95, 1.0, abs(vAcross)));
            float churn = (1.0 - smoothstep(0.0, 0.35, vWake)) * (1.0 - abs(vAcross));
            float a = max(edge * 0.7, churn * 0.6) * (1.0 - vWake) * (1.0 - vWake);
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(0.92, 0.95, 0.97), a);
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    this.wakes.frustumCulled = false
    this.wakes.renderOrder = 1
    this.group.add(this.wakes)
  }

  /** Move the ships to where they are at `seconds`; draw those near `eye` (planet frame). */
  update(seconds: number, eye: Vec3): void {
    const el = Math.hypot(eye[0], eye[1], eye[2]) || 1
    const under: Vec3 = [eye[0] / el, eye[1] / el, eye[2] / el]
    const near = Math.cos(SHIPS_NEAR)
    this.ships.forEach((ship, s) => {
      const loop = this.loops[ship.lane]
      if (loop === undefined) return
      const travelled = (ship.offset * loop.length + seconds * SPEED) % loop.length
      const at = pointAt(loop, travelled)
      const seen = at[0] * under[0] + at[1] * under[1] + at[2] * under[2] > near
      if (!seen) {
        this.hulls.setMatrixAt(s, this.gone)
        this.wakePositions.fill(0, s * WAKE_POINTS * 6, (s + 1) * WAKE_POINTS * 6)
        return
      }
      const ahead = pointAt(loop, (travelled + 0.0004) % loop.length)
      // The ship's frame: up off the sea, forward along its lane.
      const up = new THREE.Vector3(...at)
      const forward = new THREE.Vector3(ahead[0] - at[0], ahead[1] - at[1], ahead[2] - at[2])
      forward.addScaledVector(up, -forward.dot(up)).normalize()
      const side = new THREE.Vector3().crossVectors(up, forward).normalize()
      this.basis.makeBasis(side, up, forward)
      this.turn.setFromRotationMatrix(this.basis)
      // Riding the swell the water draws (swell.ts), shoaled by the depth
      // under the hull (one sounding a ship a frame; the wake takes the
      // same), and a gentle roll on it.
      const sea: Vec3 = [at[0] * SEA_RADIUS, at[1] * SEA_RADIUS, at[2] * SEA_RADIUS]
      const depth = this.depthAt(at)
      const bob =
        Math.sin(seconds * 1.3 + s * 2.1) * 0.00003 + swellHeaveAt(sea, seconds, eye, depth)
      this.place.set(...at).multiplyScalar(SEA_RADIUS + RIDE + bob)
      this.matrix.compose(this.place, this.turn, this.size)
      this.hulls.setMatrixAt(s, this.matrix)
      // The wake, back along the lane from the stern, spreading as it goes.
      for (let k = 0; k < WAKE_POINTS; k += 1) {
        const back = (travelled - 0.0004 - k * WAKE_STEP + loop.length * 4) % loop.length
        const p = pointAt(loop, back)
        const q = pointAt(loop, (back + 0.0002) % loop.length)
        const dir = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2])
        const pu = new THREE.Vector3(...p)
        dir.addScaledVector(pu, -dir.dot(pu)).normalize()
        const across = new THREE.Vector3().crossVectors(pu, dir).normalize()
        const half = 0.00006 + k * 0.00003
        const r =
          SEA_RADIUS +
          0.00004 +
          swellHeaveAt(
            [p[0] * SEA_RADIUS, p[1] * SEA_RADIUS, p[2] * SEA_RADIUS],
            seconds,
            eye,
            depth,
          )
        const v = (s * WAKE_POINTS + k) * 6
        for (const [o, sign] of [
          [0, -1],
          [3, 1],
        ] as const) {
          this.wakePositions[v + o] = p[0] * r + across.x * half * sign
          this.wakePositions[v + o + 1] = p[1] * r + across.y * half * sign
          this.wakePositions[v + o + 2] = p[2] * r + across.z * half * sign
        }
      }
    })
    this.hulls.instanceMatrix.needsUpdate = true
    const position = this.wakes.geometry.getAttribute('position')
    position.needsUpdate = true
  }
}

function loopOf(points: readonly Vec3[]): Loop {
  const at: number[] = [0]
  let length = 0
  for (let k = 0; k < points.length; k += 1) {
    const a = points[k]
    const b = points[(k + 1) % points.length]
    if (a === undefined || b === undefined) continue
    length += Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
    at.push(length)
  }
  return { points, at, length: Math.max(length, 1e-6) }
}

/** The point `distance` radians round a loop. */
function pointAt(loop: Loop, distance: number): Vec3 {
  const { points, at } = loop
  let k = 0
  while (k + 1 < at.length && (at[k + 1] ?? 0) < distance) k += 1
  const a = points[k % points.length] ?? [0, 0, 1]
  const b = points[(k + 1) % points.length] ?? a
  const span = (at[k + 1] ?? 0) - (at[k] ?? 0)
  const t = span > 0 ? (distance - (at[k] ?? 0)) / span : 0
  const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const l = Math.hypot(p[0], p[1], p[2]) || 1
  return [p[0] / l, p[1] / l, p[2] / l]
}

/** A ship: a hull, a mast and a white sail, about 0.0009 long. x across, y up, z forward. */
function shipGeometry(): THREE.BufferGeometry {
  const L = 0.00045
  const W = 0.00013
  const H = 0.0001
  const S = 0.0005
  const tri = (p: readonly number[], c: readonly [number, number, number]): number[][] => [
    [...p],
    [...c],
  ]
  const parts: number[][][] = [
    // Hull: a deck and two sloping sides meeting at a keel, pointed at the bow.
    tri([-W, H, -L, W, H, -L, W, H, L * 0.6], [0.62, 0.42, 0.25]),
    tri([-W, H, -L, W, H, L * 0.6, -W, H, L * 0.6], [0.62, 0.42, 0.25]),
    tri([-W, H, L * 0.6, W, H, L * 0.6, 0, H, L], [0.62, 0.42, 0.25]),
    tri([-W, H, -L, -W, H, L * 0.6, 0, -H, -L * 0.8], [0.44, 0.27, 0.15]),
    tri([0, -H, -L * 0.8, -W, H, L * 0.6, 0, -H, L * 0.5], [0.44, 0.27, 0.15]),
    tri([-W, H, L * 0.6, 0, H, L, 0, -H, L * 0.5], [0.44, 0.27, 0.15]),
    tri([W, H, -L, 0, -H, -L * 0.8, W, H, L * 0.6], [0.44, 0.27, 0.15]),
    tri([0, -H, -L * 0.8, 0, -H, L * 0.5, W, H, L * 0.6], [0.44, 0.27, 0.15]),
    tri([W, H, L * 0.6, 0, -H, L * 0.5, 0, H, L], [0.44, 0.27, 0.15]),
    tri([-W, H, -L, 0, -H, -L * 0.8, W, H, -L], [0.44, 0.27, 0.15]),
    // A square sail across the ship, bellied a little forward, so it reads
    // from astern and ahead alike rather than as a sliver edge on.
    tri(
      [-W * 1.5, H + S * 0.25, 0, W * 1.5, H + S * 0.25, 0, W * 1.3, H + S, L * 0.08],
      [0.95, 0.93, 0.86],
    ),
    tri(
      [-W * 1.5, H + S * 0.25, 0, W * 1.3, H + S, L * 0.08, -W * 1.3, H + S, L * 0.08],
      [0.95, 0.93, 0.86],
    ),
    // The mast, a thin dark fin above the sail.
    tri([0, H, -L * 0.03, 0, H + S * 1.2, 0, 0, H, L * 0.03], [0.25, 0.16, 0.1]),
  ]
  const positions: number[] = []
  const colours: number[] = []
  for (const [p, c] of parts) {
    if (p === undefined || c === undefined) continue
    positions.push(...p)
    for (let k = 0; k < 3; k += 1) colours.push(...c)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colours), 3))
  geometry.computeVertexNormals()
  // Seen from both sides, since the sail is a single face.
  return geometry
}

/** A pier from each harbour's shore out over the water: a plank walkway on posts. */
function piers(harbours: Harbours): THREE.Mesh {
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5)
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.42, 0.3, 0.2),
    roughness: 0.9,
  })
  weather(material, { rough: 0.03, mottle: 0.3, grain: 14000, own: 0.15 })
  const count = harbours.harbours.length * 4
  const mesh = new THREE.InstancedMesh(box, material, Math.max(1, count))
  const matrix = new THREE.Matrix4()
  const turn = new THREE.Quaternion()
  const basis = new THREE.Matrix4()
  let k = 0
  for (const harbour of harbours.harbours) {
    const up = new THREE.Vector3(...harbour.shore)
    const forward = new THREE.Vector3(...harbour.out)
    const side = new THREE.Vector3().crossVectors(up, forward).normalize()
    basis.makeBasis(side, up, forward)
    turn.setFromRotationMatrix(basis)
    // Starting a little inland, so it meets the shore whatever its height.
    const start = new THREE.Vector3(...harbour.shore).addScaledVector(forward, -0.0003)
    const deck = start.clone().multiplyScalar(SEA_RADIUS + 0.00016)
    const length = 0.0016 + harbour.size * 0.0012
    matrix.compose(deck, turn, new THREE.Vector3(0.00014, 0.00004, length))
    mesh.setMatrixAt(k++, matrix)
    // Posts down into the water along it.
    for (let p = 1; p <= 3; p += 1) {
      const at = start
        .clone()
        .addScaledVector(forward, (length * p) / 3.2)
        .multiplyScalar(SEA_RADIUS - 0.00005)
      matrix.compose(at, turn, new THREE.Vector3(0.00003, 0.00022, 0.00003))
      mesh.setMatrixAt(k++, matrix)
    }
  }
  mesh.count = k
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}
