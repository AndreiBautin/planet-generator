import * as THREE from 'three'

import { flockIn, MOST_BIRDS, type Flock } from '@/generation/birds'
import type { Vec3 } from '@/generation/cube'
import { cellOf, neighboursOf } from '@/generation/hydrology'
import type { Planet } from '@/generation/planet'

import { DETAIL_TIME } from './detail'
import { groundRadiusAt } from './patches/patch-data'
import { VALLEY_FOG } from './valley-fog'
import { SEA_RADIUS } from './water'

/** The most flocks drawn at once: two rings of cells round the eye's hold about a quarter of this. */
const MOST_FLOCKS = 32
/** How far off a bird can be seen, in radii; it fades out over the last third. */
const SEEN = 0.02
/** Above this height, in radii, there are no birds to look for. */
const HIGHEST_EYE = 0.06

/**
 * Birds: flocks wheeling over the ground near the eye (generation/birds.ts)
 * — dark land birds low over the hills, white gulls with black wingtips
 * over the coasts — banking into their turns, flapping in bursts and
 * gliding between, gone to roost at night. Each a few triangles in the
 * PS1 way, every wingbeat and turn a function of time in the vertex
 * shader, so nothing moves on the page frame by frame.
 *
 * The flocks are those of the cells in two rings round the eye; a bird
 * fades out well inside the reach of those rings, so a flock joining or
 * leaving the set is never seen to.
 */
export class Birds {
  readonly object: THREE.Mesh
  private readonly flocks: THREE.InstancedBufferAttribute
  private readonly birds: THREE.InstancedBufferAttribute
  private readonly seen = { value: SEEN }
  private readonly slots: (number | undefined)[] = new Array<number | undefined>(MOST_FLOCKS)
  private readonly known = new Map<number, Flock | undefined>()
  private world: Planet | undefined
  private cell = -1

  constructor() {
    // A bird in the PS1 way: a body and two long narrow wings bent at the
    // elbow, the elbow flapping half as far as the tip. Broad triangles
    // from body to tip read as scraps of paper. x right, y up, z forward.
    const shape = new THREE.InstancedBufferGeometry()
    shape.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          0, 0, 0.5, 0, 0, -0.6, -0.42, 0, 0.1, -1, 0, -0.24, -0.3, 0, -0.12, 0.42, 0, 0.1, 1, 0,
          -0.24, 0.3, 0, -0.12,
        ]),
        3,
      ),
    )
    shape.setAttribute(
      'birdTip',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0.5, 1, 0.3, 0.5, 1, 0.3]), 1),
    )
    shape.setIndex([0, 2, 4, 0, 4, 1, 2, 3, 4, 0, 7, 5, 0, 1, 7, 5, 7, 6])
    const count = MOST_FLOCKS * MOST_BIRDS
    this.flocks = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.birds = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.flocks.setUsage(THREE.DynamicDrawUsage)
    this.birds.setUsage(THREE.DynamicDrawUsage)
    shape.setAttribute('flockAt', this.flocks)
    shape.setAttribute('bird', this.birds)
    shape.instanceCount = count
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { birdTime: DETAIL_TIME, birdSun: VALLEY_FOG.sun, birdSeen: this.seen },
      vertexShader: /* glsl */ `
        uniform float birdTime;
        uniform vec3 birdSun;
        uniform float birdSeen;
        attribute vec4 flockAt;
        attribute vec4 bird;
        attribute float birdTip;
        varying float vTip;
        varying float vSea;
        varying float vDay;
        varying float vAlpha;
        varying float vLight;
        void main() {
          vec3 centre = flockAt.xyz;
          float flock = flockAt.w;
          vec3 up = normalize(centre);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(up, east);
          // Round the flock's centre, which itself wanders slowly; each
          // bird on its own ring and its own height, the flock all one way.
          float way = flock < 0.5 ? 1.0 : -1.0;
          float pace = mix(0.32, 0.55, fract(flock * 7.13)) * (0.85 + 0.3 * bird.y);
          float a = bird.x * 6.2831853 + birdTime * pace * way;
          float ring = (0.0012 + 0.0018 * flock) * (0.5 + 0.5 * bird.y) * (1.0 + 0.15 * sin(birdTime * 0.3 + bird.x * 20.0));
          vec3 drift = (east * sin(birdTime * 0.05 + flock * 30.0) + north * cos(birdTime * 0.04 + flock * 17.0)) * 0.0015;
          vec3 outward = cos(a) * east + sin(a) * north;
          vec3 forward = (-sin(a) * east + cos(a) * north) * way;
          vec3 here = centre + drift + outward * ring + up * (sin(birdTime * 0.6 + bird.x * 9.0) * 0.00025 + (bird.y - 0.5) * 0.0006);
          // Banked into the turn: the wings' top leans in towards the centre.
          float bank = 0.4;
          vec3 lean = normalize(up * cos(bank) - outward * sin(bank));
          vec3 right = normalize(cross(forward, lean));
          // Flapping in bursts and gliding between: a gull glides more and
          // beats slower than a small dark land bird.
          float sea = bird.z;
          float beating = smoothstep(-0.2, 0.5, sin(birdTime * mix(1.1, 0.45, sea) + bird.x * 13.0));
          float beat = sin(birdTime * mix(15.0, 8.0, sea) + bird.x * 40.0) * beating;
          float span = mix(0.00017, 0.00026, sea);
          vec3 local = position * span;
          local.y += birdTip * span * (beat * 0.6 + (1.0 - beating) * 0.1);
          vec3 p = here + right * local.x + lean * local.y + forward * local.z;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vec3 worldUp = normalize((modelMatrix * vec4(up, 0.0)).xyz);
          // To roost at dusk, and seen only near to.
          vDay = smoothstep(-0.02, 0.12, dot(worldUp, normalize(birdSun)));
          float away = distance(world.xyz, cameraPosition);
          vAlpha = bird.w * vDay * (1.0 - smoothstep(birdSeen * 0.65, birdSeen, away));
          vTip = birdTip;
          // Lit on whichever face the sun is on, the wings catching it as
          // they tilt through a beat and a bank.
          vec3 worldLean = normalize((modelMatrix * vec4(lean, 0.0)).xyz);
          vLight = 0.55 + 0.45 * abs(dot(worldLean, normalize(birdSun)));
          vSea = sea;
          gl_Position = projectionMatrix * viewMatrix * world;
          // A bird not there: off the screen rather than drawn clear.
          if (vAlpha < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vTip;
        varying float vSea;
        varying float vDay;
        varying float vAlpha;
        varying float vLight;
        void main() {
          // A gull white with black wingtips, a land bird near black, both
          // dimmed towards dusk.
          vec3 gull = mix(vec3(0.9, 0.92, 0.94), vec3(0.08), smoothstep(0.8, 0.95, vTip));
          vec3 colour = mix(vec3(0.05, 0.05, 0.06), gull * vLight, vSea) * mix(0.35, 1.0, vDay);
          gl_FragColor = vec4(colour, vAlpha);
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

  /** A new world: its own flocks, none of the last one's. */
  setWorld(world: Planet): void {
    this.world = world
    this.known.clear()
    this.slots.fill(undefined)
    this.cell = -1
    this.birds.array.fill(0)
    this.birds.needsUpdate = true
  }

  /**
   * Follow the eye: `eye` in the planet's own frame, in radii; `ground` is
   * the planet's matrix, which the birds share; `scale` the planet's size.
   */
  update(eye: Vec3, ground: THREE.Matrix4, scale: number): void {
    const height = Math.hypot(eye[0], eye[1], eye[2]) - 1
    this.object.visible = this.world !== undefined && !this.world.molten && height < HIGHEST_EYE
    if (!this.object.visible) return
    this.object.matrix.copy(ground)
    this.object.matrixWorld.copy(ground)
    this.seen.value = SEEN * scale
    const cell = cellOf(eye)
    if (cell === this.cell) return
    this.cell = cell
    this.gather(cell)
  }

  /** The flocks of two rings of cells round `cell`, each kept in the slot it had. */
  private gather(cell: number): void {
    const world = this.world
    if (world === undefined) return
    const wanted = new Set<number>([cell])
    for (const near of neighboursOf(cell)) {
      wanted.add(near)
      for (const further of neighboursOf(near)) wanted.add(further)
    }
    const flocking = new Set<number>()
    for (const k of wanted) if (this.flockOf(world, k) !== undefined) flocking.add(k)
    // Free the slots of flocks no longer near, keep the rest where they are.
    this.slots.forEach((held, slot) => {
      if (held !== undefined && !flocking.has(held)) {
        this.slots[slot] = undefined
        this.clear(slot)
      }
    })
    for (const k of flocking) {
      if (this.slots.includes(k)) continue
      const free = this.slots.indexOf(undefined)
      if (free < 0) break
      this.slots[free] = k
      this.fill(free, world, k)
    }
    this.flocks.needsUpdate = true
    this.birds.needsUpdate = true
  }

  private flockOf(world: Planet, cell: number): Flock | undefined {
    if (!this.known.has(cell)) this.known.set(cell, flockIn(world, cell))
    return this.known.get(cell)
  }

  private fill(slot: number, world: Planet, cell: number): void {
    const flock = this.flockOf(world, cell)
    if (flock === undefined) return
    // Gulls low over the water; land birds clear of the canopy (trees stand
    // 0.0015, forest.ts), where they show against the sky rather than
    // vanishing into the dark of the woods.
    const base = flock.sea ? SEA_RADIUS + 0.0012 : groundRadiusAt(world, flock.at) + 0.0028
    const radius = base + flock.seed * (flock.sea ? 0.0018 : 0.003)
    const flocks = this.flocks.array
    const birds = this.birds.array
    for (let k = 0; k < MOST_BIRDS; k += 1) {
      const at = slot * MOST_BIRDS + k
      flocks[at * 4] = flock.at[0] * radius
      flocks[at * 4 + 1] = flock.at[1] * radius
      flocks[at * 4 + 2] = flock.at[2] * radius
      flocks[at * 4 + 3] = flock.seed
      // Spread round the ring, not evenly: a flock, not a carousel.
      const spread = Math.sin((cell * 13 + k) * 91.7) * 43758.5453
      birds[at * 4] = (k + (spread - Math.floor(spread)) * 0.8) / MOST_BIRDS
      birds[at * 4 + 1] = (k * 0.618 + flock.seed) % 1
      birds[at * 4 + 2] = flock.sea ? 1 : 0
      birds[at * 4 + 3] = k < flock.birds ? 1 : 0
    }
  }

  private clear(slot: number): void {
    const birds = this.birds.array
    for (let k = 0; k < MOST_BIRDS; k += 1) birds[(slot * MOST_BIRDS + k) * 4 + 3] = 0
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}
