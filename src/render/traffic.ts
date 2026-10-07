import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'

/** How fast a cart goes, radians a second. */
const SPEED = 0.00035
/** Carts are drawn within this of the eye, in radians, shrinking away over the last stretch. */
const NEAR = 0.045
const SHRINK_FROM = 0.03
/** A cart nose to tail, in radii: larger than life, as the herds are. */
const LENGTH = 0.00022

interface Cart {
  /** The road it runs, as points with the distance along at each. */
  readonly points: readonly Vec3[]
  readonly at: readonly number[]
  readonly length: number
  /** Where along it starts, and which way first. */
  readonly offset: number
  readonly seed: number
}

/**
 * Traffic: carts going along the roads between the towns (towns.ts), a
 * horse and a covered wagon each, back and forth along a road at a walk by
 * the shared clock — so every device puts a cart in the same place — with
 * a lantern on each after dusk, a warm point moving along the dark country
 * between the towns' glows.
 *
 * Kept near the eye and shrinking away at the edge of that reach, as the
 * herds do. A road broken at a river (the lights stop on either bank) is
 * two roads, and its carts turn back at the water; the bridge stands there
 * for the eye rather than the wagons.
 */
export class Traffic {
  readonly group = new THREE.Group()
  private readonly carts: Cart[] = []
  private readonly bodies: THREE.InstancedMesh
  private readonly lanterns: THREE.Points
  private readonly lanternAt: Float32Array
  private readonly lanternGlow: Float32Array
  private readonly matrix = new THREE.Matrix4()
  private readonly basis = new THREE.Matrix4()
  private readonly turn = new THREE.Quaternion()
  private readonly up = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly place = new THREE.Vector3()
  private readonly size = new THREE.Vector3()
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)
  private readonly sunHere = new THREE.Vector3()

  constructor(roads: readonly (readonly Vec3[])[]) {
    roads.forEach((points, r) => {
      const at: number[] = [0]
      let length = 0
      for (let k = 1; k < points.length; k += 1) {
        const a = points[k - 1]
        const b = points[k]
        if (a === undefined || b === undefined) continue
        length += angle(a, b)
        at.push(length)
      }
      if (length < 0.004) return
      const count = length > 0.02 ? 2 : 1
      for (let c = 0; c < count; c += 1)
        this.carts.push({
          points,
          at,
          length,
          offset: (c + roll(r * 3 + c)) / count,
          seed: roll(r * 7 + c),
        })
    })
    const count = Math.max(1, this.carts.length)
    const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
    // A little light of its own colour, as the herds have: a high sun left
    // its flanks the deep blue of the sky's shade.
    wood.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.22;',
      )
    }
    this.bodies = new THREE.InstancedMesh(cartGeometry(), wood, count)
    this.bodies.frustumCulled = false
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.lanternAt = new Float32Array(count * 3)
    this.lanternGlow = new Float32Array(count)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.lanternAt, 3))
    geometry.setAttribute('glow', new THREE.BufferAttribute(this.lanternGlow, 1))
    this.lanterns = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float glow;
          varying float vGlow;
          void main() {
            vGlow = glow;
            vec4 view = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = glow > 0.01 ? clamp(0.0003 / max(-view.z, 1e-6) * 900.0, 3.0, 12.0) : 0.0;
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vGlow;
          void main() {
            float spot = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
            // A bright core in a soft halo: a lantern seen across dark country.
            float core = 1.0 - smoothstep(0.0, 0.15, length(gl_PointCoord - 0.5));
            gl_FragColor = vec4(vec3(1.0, 0.72, 0.35) * (spot * spot * 0.8 + core * 1.5) * vGlow, 1.0);
          }
        `,
      }),
    )
    this.lanterns.frustumCulled = false
    this.lanterns.renderOrder = 3
    this.group.add(this.bodies, this.lanterns)
  }

  /**
   * Move the carts to where they are at `seconds`; draw those near `eye`
   * (the planet's frame, in radii). `sun` is the direction to the sun in
   * the planet's frame, for the lanterns.
   */
  update(eye: Vec3, sun: THREE.Vector3, seconds: number): void {
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    const under: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
    this.group.visible = length - 1 < 0.06 && this.carts.length > 0
    if (!this.group.visible) return
    this.sunHere.copy(sun).normalize()
    const near = Math.cos(NEAR)
    this.carts.forEach((cart, k) => {
      // Back and forth along the road: a triangle wave in distance.
      const run = (cart.offset * 2 + (seconds * SPEED) / cart.length) % 2
      const forward = run < 1
      const d = (forward ? run : 2 - run) * cart.length
      const here = pointAt(cart, d)
      const next = pointAt(
        cart,
        Math.min(cart.length, Math.max(0, d + (forward ? 1 : -1) * 0.0003)),
      )
      const facing = here[0] * under[0] + here[1] * under[1] + here[2] * under[2]
      const dir = Math.hypot(here[0], here[1], here[2]) || 1
      const off = Math.acos(Math.min(1, facing / dir))
      if (facing / dir < near) {
        this.bodies.setMatrixAt(k, this.gone)
        this.lanternGlow[k] = 0
        return
      }
      const shown = 1 - smooth(SHRINK_FROM, NEAR, off)
      this.up.set(...here).normalize()
      this.ahead.set(next[0] - here[0], next[1] - here[1], next[2] - here[2])
      this.ahead.addScaledVector(this.up, -this.ahead.dot(this.up)).normalize()
      this.side.crossVectors(this.up, this.ahead).normalize()
      this.basis.makeBasis(this.side, this.up, this.ahead)
      this.turn.setFromRotationMatrix(this.basis)
      this.place.set(...here)
      this.size.setScalar(LENGTH * shown)
      this.matrix.compose(this.place, this.turn, this.size)
      this.bodies.setMatrixAt(k, this.matrix)
      // The lantern hangs at the front of the wagon, lit after dusk.
      const night = 1 - smooth(-0.1, 0.05, this.up.dot(this.sunHere))
      this.place
        .addScaledVector(this.up, LENGTH * 0.75 * shown)
        .addScaledVector(this.ahead, LENGTH * 0.1 * shown)
      this.lanternAt[k * 3] = this.place.x
      this.lanternAt[k * 3 + 1] = this.place.y
      this.lanternAt[k * 3 + 2] = this.place.z
      this.lanternGlow[k] = night * shown * (0.75 + 0.25 * Math.sin(seconds * 3 + cart.seed * 40))
    })
    this.bodies.instanceMatrix.needsUpdate = true
    const geometry = this.lanterns.geometry
    const position = geometry.getAttribute('position')
    const glow = geometry.getAttribute('glow')
    position.needsUpdate = true
    glow.needsUpdate = true
  }
}

/** The point `distance` along a cart's road. */
function pointAt(cart: Cart, distance: number): Vec3 {
  const { points, at } = cart
  let k = 0
  while (k + 2 < at.length && (at[k + 1] ?? 0) < distance) k += 1
  const a = points[k] ?? [0, 0, 1]
  const b = points[k + 1] ?? a
  const span = (at[k + 1] ?? 0) - (at[k] ?? 0)
  const t = span > 0 ? Math.min(1, Math.max(0, (distance - (at[k] ?? 0)) / span)) : 0
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** A wagon with a canvas cover and a horse before it: boxes, coloured, on the ground at y = 0, nose to +z. */
function cartGeometry(): THREE.BufferGeometry {
  const parts: [number, number, number, number, number, number, number, number, number][] = [
    // Bed, cover, wheels' line, horse body, horse head, legs.
    [0, 0.22, -0.18, 0.42, 0.14, 0.62, 0.42, 0.28, 0.16],
    [0, 0.42, -0.18, 0.4, 0.28, 0.56, 0.86, 0.82, 0.7],
    [0, 0.08, -0.18, 0.48, 0.16, 0.5, 0.12, 0.1, 0.08],
    [0, 0.34, 0.32, 0.16, 0.18, 0.36, 0.3, 0.2, 0.12],
    [0, 0.46, 0.52, 0.1, 0.16, 0.14, 0.3, 0.2, 0.12],
    [0, 0.12, 0.32, 0.12, 0.24, 0.3, 0.22, 0.15, 0.1],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const colours: number[] = []
  for (const [x, y, z, w, h, d, r, g, b] of parts) {
    const box = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed()
    const p = box.getAttribute('position')
    const n = box.getAttribute('normal')
    for (let k = 0; k < p.count; k += 1) {
      positions.push(p.getX(k), p.getY(k), p.getZ(k))
      normals.push(n.getX(k), n.getY(k), n.getZ(k))
      colours.push(r, g, b)
    }
    box.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  return geometry
}

const angle = (a: Vec3, b: Vec3): number => {
  const la = Math.hypot(a[0], a[1], a[2]) || 1
  const lb = Math.hypot(b[0], b[1], b[2]) || 1
  return Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))
}

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** A fixed roll, 0 to 1, for a number. */
function roll(n: number): number {
  let h = Math.imul(n + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}
