import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'

import { DETAIL_TIME } from './detail'
import { SEA_RADIUS } from './water'

/** The most shafts drawn at once. */
const MOST_SHAFTS = 256
/** The lattice the shafts stand on, in radii: one shaft to a cell at most. */
const CELL = 0.0011
/** How many cells out from the eye's, each way. */
const REACH = 6
/**
 * How far from the point of the surface over the eye a shaft is drawn, in
 * radii: whole to the first, gone by the second. Inside the lattice's
 * reach, so a shaft fades out before the gathering stops finding it — the
 * first version faded by distance from the eye out to 0.02, past where the
 * lattice reached, and shafts at the rim would have popped.
 */
const FADE_FROM = 0.0035
const FADE_TO = 0.006
/** How far a shaft hangs down from the surface, and how wide it is, in radii. */
const LENGTH = 0.007
const WIDTH = 0.0003

/**
 * Light under the sea: shafts of sun hanging down from the surface through
 * the water, slanted the way the light comes in, bending towards straight
 * down as water bends it, fading as they fall and shimmering as the waves
 * above pass. The sunbeams pass (sunbeams.ts) is off under the sea, since
 * it gathers light from the sun's place on the screen, and the surface
 * from below is not where the sun is.
 *
 * **Anchored to the planet, not to the eye**: a shaft stands on a lattice
 * cell (one to a cell, by the cell's hash), so swimming past them moves
 * through them rather than carrying them along — the same reason the fish
 * keep to their water. Gathered each frame from the cells round the eye
 * that meet the surface's shell, a few hundred checks, only while under.
 */
export class SeaLight {
  readonly object: THREE.Mesh
  private readonly tops: THREE.InstancedBufferAttribute
  private readonly fades: THREE.InstancedBufferAttribute
  private readonly down = { value: new THREE.Vector3(0, -1, 0) }
  private readonly strength = { value: 0 }
  private readonly colour = { value: new THREE.Color() }
  private readonly size = { value: new THREE.Vector2(LENGTH, WIDTH) }
  private readonly reach = { value: 0.01 }
  private readonly point = new THREE.Vector3()

  constructor() {
    const shape = new THREE.InstancedBufferGeometry()
    // A quad: x across (-1 or 1), y down the shaft (0 at the surface).
    shape.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3),
    )
    shape.setIndex([0, 2, 1, 1, 2, 3])
    this.tops = new THREE.InstancedBufferAttribute(new Float32Array(MOST_SHAFTS * 4), 4)
    this.tops.setUsage(THREE.DynamicDrawUsage)
    shape.setAttribute('shaftTop', this.tops)
    this.fades = new THREE.InstancedBufferAttribute(new Float32Array(MOST_SHAFTS), 1)
    this.fades.setUsage(THREE.DynamicDrawUsage)
    shape.setAttribute('shaftFade', this.fades)
    shape.instanceCount = 0
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        shaftTime: DETAIL_TIME,
        shaftDown: this.down,
        shaftStrength: this.strength,
        shaftColour: this.colour,
        shaftSize: this.size,
        shaftReach: this.reach,
      },
      vertexShader: /* glsl */ `
        uniform vec3 shaftDown;
        uniform vec2 shaftSize;
        attribute vec4 shaftTop;
        attribute float shaftFade;
        varying float vFade;
        varying vec2 vAt;
        varying float vSeed;
        varying float vAway;
        void main() {
          float along = position.y;
          // Each shaft its own length, so their ends do not line up.
          float hangs = shaftSize.x * (0.6 + 0.6 * fract(shaftTop.w * 7.31));
          vec3 p = shaftTop.xyz + shaftDown * hangs * along;
          vec3 toEye = normalize(cameraPosition - p);
          vec3 across = normalize(cross(shaftDown, toEye) + vec3(1e-6));
          // Wider as it falls, as light spreads.
          p += across * position.x * shaftSize.y * (0.6 + 0.8 * fract(shaftTop.w * 3.7)) * (1.0 + along * 0.8);
          vAt = vec2(position.x, along);
          vSeed = shaftTop.w;
          vFade = shaftFade;
          vAway = distance(p, cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float shaftTime;
        uniform float shaftStrength;
        uniform vec3 shaftColour;
        uniform float shaftReach;
        varying vec2 vAt;
        varying float vSeed;
        varying float vAway;
        varying float vFade;
        void main() {
          // Clamped: interpolation can carry a coordinate a hair past its end,
          // and a power of a negative is NaN, which the bloom spread over the
          // whole frame as black.
          vec2 at = clamp(vAt, vec2(-1.0, 0.0), vec2(1.0, 1.0));
          float edge = 1.0 - at.x * at.x;
          float fall = smoothstep(0.0, 0.15, at.y) * pow(1.0 - at.y, 2.2);
          // Waves passing above brighten and dim each shaft in turn.
          float shimmer = 0.45 + 0.55 * sin(shaftTime * (0.5 + vSeed * 0.6) + vSeed * 40.0) * sin(shaftTime * 0.23 + vSeed * 17.0);
          // Gone right at the eye, so swimming through one is not a flash: at
          // a fifth of this, a shaft beside the eye drew a hard-edged slab
          // where its quad met the near plane.
          float near = smoothstep(shaftReach * 0.15, shaftReach * 0.5, vAway) * vFade;
          float a = edge * edge * fall * max(0.0, shimmer) * near * shaftStrength;
          if (a < 0.002) discard;
          gl_FragColor = vec4(max(shaftColour * a, vec3(0.0)), 1.0);
        }
      `,
    })
    this.object = new THREE.Mesh(shape, material)
    this.object.frustumCulled = false
    this.object.renderOrder = 4
    this.object.visible = false
  }

  /**
   * `eye` in the planet's frame, in radii; `ground` the planet's matrix;
   * `sun` the direction to the sun, in the room; `under` 0 to 1; `day`
   * how much daylight the water has; `water` its colour.
   */
  update(
    eye: Vec3,
    ground: THREE.Matrix4,
    sun: THREE.Vector3,
    scale: number,
    under: number,
    day: number,
    water: THREE.Color,
  ): void {
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    const up: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
    const upRoom = this.point.set(...up).transformDirection(ground)
    // The sun's height over this sea, and the light's way down through it:
    // bent towards straight down, as water bends it.
    const high = Math.max(0, upRoom.dot(sun))
    const strength = under * day * Math.min(1, high * 3)
    this.strength.value = strength * 0.22
    this.object.visible = strength > 0.01
    if (!this.object.visible) return
    this.down.value.copy(sun).multiplyScalar(-0.6).addScaledVector(upRoom, -1).normalize()
    this.colour.value.copy(water).multiplyScalar(2.2).addScalar(0.12)
    this.size.value.set(LENGTH * scale, WIDTH * scale)
    this.reach.value = FADE_TO * scale
    // The cells round the eye that the surface's shell passes through.
    const shell = SEA_RADIUS - 0.0001
    // Gathered round the point of the surface over the eye, not the eye:
    // deep down, the eye's own cells do not reach the surface at all.
    const over: Vec3 = [up[0] * shell, up[1] * shell, up[2] * shell]
    const base = [
      Math.floor(over[0] / CELL),
      Math.floor(over[1] / CELL),
      Math.floor(over[2] / CELL),
    ]
    const [bx = 0, by = 0, bz = 0] = base
    const tops = this.tops.array
    let n = 0
    for (let i = -REACH; i <= REACH && n < MOST_SHAFTS; i += 1) {
      for (let j = -REACH; j <= REACH && n < MOST_SHAFTS; j += 1) {
        for (let k = -REACH; k <= REACH && n < MOST_SHAFTS; k += 1) {
          const cx = bx + i
          const cy = by + j
          const cz = bz + k
          const x = (cx + 0.5) * CELL
          const y = (cy + 0.5) * CELL
          const z = (cz + 0.5) * CELL
          const r = Math.hypot(x, y, z)
          if (Math.abs(r - shell) > CELL * 0.5) continue
          const roll = hash(cx, cy, cz)
          // Half the cells have a shaft; it sits anywhere in its cell.
          if (roll > 0.5) continue
          const jx = x + (hash(cy, cz, cx) - 0.5) * CELL
          const jy = y + (hash(cz, cx, cy) - 0.5) * CELL
          const jz = z + (hash(cx + 7, cy, cz) - 0.5) * CELL
          const jr = Math.hypot(jx, jy, jz) || 1
          const tx = (jx / jr) * shell
          const ty = (jy / jr) * shell
          const tz = (jz / jr) * shell
          const off = Math.hypot(tx - over[0], ty - over[1], tz - over[2])
          if (off >= FADE_TO) continue
          const t = Math.max(0, (off - FADE_FROM) / (FADE_TO - FADE_FROM))
          this.fades.array[n] = 1 - t * t * (3 - 2 * t)
          this.point.set(tx, ty, tz).applyMatrix4(ground)
          tops[n * 4] = this.point.x
          tops[n * 4 + 1] = this.point.y
          tops[n * 4 + 2] = this.point.z
          tops[n * 4 + 3] = roll * 2
          n += 1
        }
      }
    }
    const geometry = this.object.geometry
    if (geometry instanceof THREE.InstancedBufferGeometry) geometry.instanceCount = n
    this.tops.needsUpdate = true
    this.fades.needsUpdate = true
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}

/** A cell's roll, 0 to 1. */
function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
