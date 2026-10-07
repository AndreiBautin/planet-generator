import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { MOST_FISH, schoolIn, type School } from '@/generation/fish'
import { cellOf } from '@/generation/hydrology'
import type { Planet } from '@/generation/planet'

import { DETAIL_TIME } from './detail'
import { NearCells } from './near-cells'
import { floorRadiusAt } from './patches/patch-data'
import { SEA_RADIUS } from './water'

/** The most schools drawn at once. */
const MOST_SCHOOLS = 32
/** How far off a fish can be seen, in radii, fading over the last third: as far as the water's haze lets anything be seen, and well inside the two rings of cells the schools are gathered from. */
const SEEN = 0.02

/**
 * Fish: schools circling in the water near the eye on a dive
 * (generation/fish.ts) — a few triangles each, flat and side-on, tails
 * beating, the school turning together. The birds' arrangement (birds.ts)
 * under the surface: every stroke and turn a function of time in the
 * shader, schools kept to the cells round the eye and faded out well
 * inside their reach, so none pops. Hazed by the water as the ground is,
 * since a shader of its own takes no fog.
 */
export class Fish {
  readonly object: THREE.Mesh
  private readonly schools: THREE.InstancedBufferAttribute
  private readonly fish: THREE.InstancedBufferAttribute
  private readonly seen = { value: SEEN }
  private readonly haze = { value: new THREE.Color() }
  private readonly hazeDensity = { value: 0 }
  private readonly near = new NearCells<School>(
    MOST_SCHOOLS,
    (cell) => (this.world === undefined ? undefined : schoolIn(this.world, cell)),
    (slot, cell, school) => {
      this.fill(slot, cell, school)
    },
    (slot) => {
      this.clear(slot)
    },
  )
  private world: Planet | undefined

  constructor() {
    // A fish side-on: a diamond of a body and a forked tail. x across, y
    // up, z forward; `fishBend` how far back along it a point is, which
    // is how much the stroke swings it.
    const shape = new THREE.InstancedBufferGeometry()
    shape.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          0, 0, 1, 0, 0.28, 0.15, 0, -0.24, 0.1, 0, 0, -0.55, 0, 0.32, -1, 0, -0.32, -1,
        ]),
        3,
      ),
    )
    shape.setAttribute(
      'fishBend',
      new THREE.BufferAttribute(new Float32Array([0, 0.3, 0.3, 0.7, 1, 1]), 1),
    )
    shape.setIndex([0, 1, 3, 0, 3, 2, 3, 4, 5])
    const count = MOST_SCHOOLS * MOST_FISH
    this.schools = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.fish = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.schools.setUsage(THREE.DynamicDrawUsage)
    this.fish.setUsage(THREE.DynamicDrawUsage)
    shape.setAttribute('schoolAt', this.schools)
    shape.setAttribute('fishOf', this.fish)
    shape.instanceCount = count
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        fishTime: DETAIL_TIME,
        fishSeen: this.seen,
        fishHaze: this.haze,
        fishHazeDensity: this.hazeDensity,
      },
      vertexShader: /* glsl */ `
        uniform float fishTime;
        uniform float fishSeen;
        attribute vec4 schoolAt;
        attribute vec4 fishOf;
        attribute float fishBend;
        varying float vKind;
        varying float vAway;
        varying float vTop;
        void main() {
          vec3 centre = schoolAt.xyz;
          float school = schoolAt.w;
          vec3 up = normalize(centre);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(up, east);
          // Round the school's centre, all one way, each on its own ring
          // and depth, the centre itself wandering.
          float way = school < 0.5 ? 1.0 : -1.0;
          float pace = mix(0.25, 0.45, fract(school * 5.31)) * (0.9 + 0.2 * fishOf.y);
          float a = fishOf.x * 6.2831853 + fishTime * pace * way;
          float ring = (0.0009 + 0.0015 * school) * (0.6 + 0.4 * fishOf.y);
          vec3 drift = (east * sin(fishTime * 0.07 + school * 30.0) + north * cos(fishTime * 0.05 + school * 17.0)) * 0.0008;
          vec3 outward = cos(a) * east + sin(a) * north;
          vec3 forward = (-sin(a) * east + cos(a) * north) * way;
          vec3 here = centre + drift + outward * ring + up * ((fishOf.y - 0.5) * 0.0005 + sin(fishTime * 0.8 + fishOf.x * 9.0) * 0.00012);
          vec3 across = normalize(cross(forward, up));
          // The stroke: the tail swings across, more the further back.
          float stroke = sin(fishTime * 9.0 + fishOf.x * 40.0) * fishBend * fishBend * 0.35;
          float size = 0.00022 * (0.8 + 0.4 * fishOf.y);
          vec3 local = position * size;
          vec3 p = here + across * (local.x + stroke * size) + up * local.y + forward * local.z;
          vec4 world = modelMatrix * vec4(p, 1.0);
          float away = distance(world.xyz, cameraPosition);
          vAway = away;
          vKind = fishOf.z;
          vTop = position.y;
          float shown = fishOf.w * (1.0 - smoothstep(fishSeen * 0.65, fishSeen, away));
          gl_Position = projectionMatrix * viewMatrix * world;
          if (shown < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 fishHaze;
        uniform float fishHazeDensity;
        varying float vKind;
        varying float vAway;
        varying float vTop;
        void main() {
          // Silver, blue or orange, darker along the back.
          vec3 colour = vKind < 0.5 ? vec3(0.62, 0.68, 0.72) : (vKind < 1.5 ? vec3(0.16, 0.38, 0.75) : vec3(0.95, 0.45, 0.12));
          colour *= 0.75 + 0.35 * smoothstep(0.2, -0.2, vTop);
          // In the water's haze, as the ground is.
          float hazed = 1.0 - exp(-pow(vAway * fishHazeDensity, 2.0));
          gl_FragColor = vec4(mix(colour * fishHaze * 3.0 + colour * 0.15, fishHaze, hazed), 1.0);
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

  /** A new world: its own schools, none of the last one's. */
  setWorld(world: Planet): void {
    this.world = world
    this.near.reset()
    this.fish.array.fill(0)
    this.fish.needsUpdate = true
  }

  /**
   * Follow the eye: `eye` in the planet's frame, in radii; `ground` the
   * planet's matrix; `under` how far under the sea the eye is (0 to 1),
   * and the water's haze as the scene has it.
   */
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
    this.schools.needsUpdate = true
    this.fish.needsUpdate = true
  }

  private fill(slot: number, cell: number, school: School): void {
    const world = this.world
    if (world === undefined) return
    // Between the bed and the surface, deeper for some schools than others.
    const floor = floorRadiusAt(world, school.at)
    const radius = floor + (SEA_RADIUS - floor) * (0.25 + 0.4 * school.seed)
    const schools = this.schools.array
    const fish = this.fish.array
    for (let k = 0; k < MOST_FISH; k += 1) {
      const at = slot * MOST_FISH + k
      schools[at * 4] = school.at[0] * radius
      schools[at * 4 + 1] = school.at[1] * radius
      schools[at * 4 + 2] = school.at[2] * radius
      schools[at * 4 + 3] = school.seed
      const spread = Math.sin((cell * 7 + k) * 63.1) * 43758.5453
      fish[at * 4] = (k + (spread - Math.floor(spread)) * 0.9) / MOST_FISH
      fish[at * 4 + 1] = (k * 0.618 + school.seed) % 1
      fish[at * 4 + 2] = school.kind
      fish[at * 4 + 3] = k < school.fish ? 1 : 0
    }
  }

  private clear(slot: number): void {
    const fish = this.fish.array
    for (let k = 0; k < MOST_FISH; k += 1) fish[(slot * MOST_FISH + k) * 4 + 3] = 0
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}
