import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { cellOf } from '@/generation/hydrology'
import { forestIn, type Forest } from '@/generation/kelp'
import type { Planet } from '@/generation/planet'

import { DETAIL_TIME } from './detail'
import { NearCells } from './near-cells'
import { floorRadiusAt } from './patches/patch-data'
import { SEA_RADIUS } from './water'

/** The most forests drawn at once. */
const MOST_FORESTS = 24
/** Stalks in a forest. */
const STALKS = 80
/** Segments up a stalk. */
const SEGMENTS = 12
/** How far off kelp can be seen, in radii: the fish's reach, as far as the water lets anything be seen. */
const SEEN = 0.02
/**
 * The bed kelp grows on, in radii under the surface: deep enough to swim
 * among (a dive keeps 0.0025 off the bed and 0.0012 under the surface,
 * rig.ts), not so deep it is in the dark.
 */
const SHALLOWEST = 0.0035
const DEEPEST = 0.016

/**
 * Kelp: forests of tall stalks standing up off the cool sea bed towards
 * the light (generation/kelp.ts), each a twisting ribbon whose blades
 * widen and narrow up its length, swaying with the swell and leaning with
 * a current. The fish's arrangement (fish.ts): kept to the cells round the
 * eye by `NearCells`, every sway a function of time in the shader, hazed
 * by the water by hand, and drawn only on a dive.
 */
export class Kelp {
  readonly object: THREE.Mesh
  private readonly bases: THREE.InstancedBufferAttribute
  private readonly stalks: THREE.InstancedBufferAttribute
  private readonly seen = { value: SEEN }
  private readonly haze = { value: new THREE.Color() }
  private readonly hazeDensity = { value: 0 }
  private readonly near = new NearCells<Forest>(
    MOST_FORESTS,
    (cell) => (this.world === undefined ? undefined : forestIn(this.world, cell)),
    (slot, cell, forest) => {
      this.fill(slot, cell, forest)
    },
    (slot) => {
      this.clear(slot)
    },
  )
  private world: Planet | undefined

  constructor() {
    // A ribbon: x across (-1 or 1), y up its length (0 to 1).
    const positions: number[] = []
    const index: number[] = []
    for (let k = 0; k <= SEGMENTS; k += 1) {
      positions.push(-1, k / SEGMENTS, 0, 1, k / SEGMENTS, 0)
      if (k < SEGMENTS) index.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2)
    }
    const shape = new THREE.InstancedBufferGeometry()
    shape.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
    shape.setIndex(index)
    const count = MOST_FORESTS * STALKS
    this.bases = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.stalks = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.bases.setUsage(THREE.DynamicDrawUsage)
    this.stalks.setUsage(THREE.DynamicDrawUsage)
    shape.setAttribute('kelpBase', this.bases)
    shape.setAttribute('kelpOf', this.stalks)
    shape.instanceCount = count
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        kelpTime: DETAIL_TIME,
        kelpSeen: this.seen,
        kelpHaze: this.haze,
        kelpHazeDensity: this.hazeDensity,
      },
      vertexShader: /* glsl */ `
        uniform float kelpTime;
        uniform float kelpSeen;
        attribute vec4 kelpBase;
        attribute vec4 kelpOf;
        varying float vAlong;
        varying float vAway;
        varying float vTint;
        varying float vSide;
        void main() {
          vSide = position.x;
          vec3 base = kelpBase.xyz;
          float tall = kelpBase.w;
          float seed = kelpOf.x;
          float along = position.y;
          vec3 up = normalize(base);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(up, east);
          // The current leans the whole forest one way; the swell sways
          // each stalk about it, the top most, slowly.
          vec3 lean = cos(kelpOf.y) * east + sin(kelpOf.y) * north;
          vec3 aside = cross(up, lean);
          float swell = sin(kelpTime * 0.55 + seed * 40.0 - along * 1.6);
          float swing = sin(kelpTime * 0.31 + seed * 23.0) * 0.5;
          vec3 bend = (lean * (0.12 + 0.1 * swell) + aside * 0.08 * swing) * tall * along * along;
          vec3 spine = base + up * (tall * along) + bend;
          // Blades: wide and narrow up the stalk, twisting as it rises.
          float blade = 0.45 + 0.55 * abs(sin(along * 22.0 + seed * 9.0));
          float wide = 0.00016 * blade * (1.0 - 0.35 * along) * (0.3 + 0.7 * smoothstep(0.0, 0.15, along));
          float twist = along * 4.0 + seed * 6.2831853 + kelpTime * 0.2;
          vec3 across = cos(twist) * aside + sin(twist) * lean;
          vec3 p = spine + across * position.x * wide;
          vec4 world = modelMatrix * vec4(p, 1.0);
          float away = distance(world.xyz, cameraPosition);
          vAway = away;
          vAlong = along;
          vTint = kelpOf.w;
          float shown = kelpOf.z * (1.0 - smoothstep(kelpSeen * 0.65, kelpSeen, away));
          gl_Position = projectionMatrix * viewMatrix * world;
          if (shown < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 kelpHaze;
        uniform float kelpHazeDensity;
        varying float vAlong;
        varying float vAway;
        varying float vTint;
        varying float vSide;
        void main() {
          // Olive and amber, darker at the holdfast, lit from above where
          // the blades near the light.
          // Linear values: they read twice as pale on screen.
          vec3 colour = mix(vec3(0.025, 0.03, 0.006), vec3(0.15, 0.14, 0.02), vAlong);
          colour = mix(colour, colour * vec3(1.25, 0.8, 0.45), vTint);
          colour *= 0.6 + 0.8 * vAlong * vAlong;
          // A blade is ruffled at its edges and lighter either side of its
          // rib, so one close to the eye is not a flat plank of colour.
          colour *= (0.75 + 0.35 * (1.0 - vSide * vSide)) * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.12, abs(vSide))));
          float hazed = 1.0 - exp(-pow(vAway * kelpHazeDensity, 2.0));
          // Lit by the water round it but keeping its own olive: tinted by the
          // haze as the fish are, it came out the blue of the water itself.
          gl_FragColor = vec4(mix(colour * (kelpHaze * 1.6 + 0.45), kelpHaze, hazed), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.object = new THREE.Mesh(shape, material)
    this.object.frustumCulled = false
    this.object.matrixAutoUpdate = false
    this.object.renderOrder = 2
    this.object.visible = false
  }

  /** A new world: its own forests, none of the last one's. */
  setWorld(world: Planet): void {
    this.world = world
    this.near.reset()
    this.stalks.array.fill(0)
    this.stalks.needsUpdate = true
  }

  /** Follow the eye, as the fish do (fish.ts). */
  update(
    eye: Vec3,
    ground: THREE.Matrix4,
    scale: number,
    under: number,
    haze: THREE.Color,
    density: number,
  ): void {
    this.object.visible = this.world !== undefined && !this.world.molten && under > 0.5
    if (!this.object.visible) return
    this.object.matrix.copy(ground)
    this.object.matrixWorld.copy(ground)
    this.seen.value = SEEN * scale
    this.haze.value.copy(haze)
    this.hazeDensity.value = density
    if (!this.near.near(cellOf(eye))) return
    this.bases.needsUpdate = true
    this.stalks.needsUpdate = true
  }

  private fill(slot: number, cell: number, forest: Forest): void {
    const world = this.world
    if (world === undefined) return
    const bases = this.bases.array
    const stalks = this.stalks.array
    const lean = forest.seed * Math.PI * 2
    let h = Math.imul(cell + 1, 0x9e3779b1)
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    for (let k = 0; k < STALKS; k += 1) {
      const at = slot * STALKS + k
      // Clumped: most stalks near the middle, a few strays further out.
      const r = forest.spread * Math.pow(next(), 0.7)
      const direction = around(forest.at, r, next() * Math.PI * 2)
      const floor = floorRadiusAt(world, direction)
      const depth = SEA_RADIUS - floor
      const grows = depth > SHALLOWEST && depth < DEEPEST
      // Reaching most of the way up, never through the surface.
      const tall = Math.min(depth * (0.55 + 0.35 * next()), depth - 0.0003)
      bases[at * 4] = direction[0] * (floor - 0.00003)
      bases[at * 4 + 1] = direction[1] * (floor - 0.00003)
      bases[at * 4 + 2] = direction[2] * (floor - 0.00003)
      bases[at * 4 + 3] = Math.max(0, tall)
      stalks[at * 4] = next()
      stalks[at * 4 + 1] = lean + (next() - 0.5) * 0.6
      stalks[at * 4 + 2] = grows && tall > 0.0003 ? 1 : 0
      stalks[at * 4 + 3] = next()
    }
  }

  private clear(slot: number): void {
    const stalks = this.stalks.array
    for (let k = 0; k < STALKS; k += 1) stalks[(slot * STALKS + k) * 4 + 2] = 0
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
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
