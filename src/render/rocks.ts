import * as THREE from 'three'

import { rocksIn, type Rocks } from '@/generation/coasts'
import type { Vec3 } from '@/generation/cube'
import { cellCentre, cellOf } from '@/generation/hydrology'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'
import { DETAIL_TIME } from './detail'
import { NearCells } from './near-cells'
import { floorRadiusAt } from './patches/patch-data'
import { SEA_RADIUS } from './water'
import { drawOnlyLive } from './instances'
import { weather } from './weathered'

/** The most groups of rocks drawn at once. */
const MOST_GROUPS = 24
/** Pillars in a group at most: four stacks and an arch's two feet and its span. */
const PIECES = 7
/** Spray specks round each pillar. */
const SPRAY = 10
/** Where rocks shrink away into the sea, in radians from the eye: well inside the cells gathered. */
const SHRINK_FROM = 0.018
const GONE_AT = 0.026
/**
 * The same by the cell's centre, which is always inside the cell: gone by
 * `HELD_REACH` (near-cells.ts), inside which every cell is held.
 */
const HOME_FROM = 0.021
const HOME_GONE = 0.026
/** Above this height there are no rocks to look for. */
const HIGHEST_EYE = 0.06

/**
 * Rocky coasts (generation/coasts.ts): stacks standing off high shores,
 * now and then an arch, and spray bursting white at their feet as the
 * swell comes in. Each pillar is a jagged, leaning column of the high
 * ground's own rock from the sea bed up into the air, built where the bed
 * was measured for it when its group came near.
 *
 * Kept to the cells round the eye by `NearCells`, as the birds and fish
 * are, and shrinking away into the sea at the edge of that reach.
 */
export class CoastRocks {
  readonly group = new THREE.Group()
  private readonly pillars: THREE.InstancedMesh
  private readonly spray: THREE.Points
  private readonly sprayAt: Float32Array
  private readonly sprayOf: Float32Array
  private readonly placed: {
    matrices: THREE.Matrix4[]
    sprays: boolean[]
    at: Vec3
    /** The centre of the cell it belongs to: always inside it, unlike the stacks. */
    home: Vec3
  }[] = []
  private readonly near = new NearCells<Rocks>(
    MOST_GROUPS,
    (cell) => (this.world === undefined ? undefined : rocksIn(this.world, cell)),
    (slot, cell, rocks) => {
      this.build(slot, rocks)
      const placed = this.placed[slot]
      if (placed !== undefined) placed.home = cellCentre(cell)
    },
    (slot) => {
      this.clear(slot)
    },
  )
  private world: Planet | undefined
  private readonly matrix = new THREE.Matrix4()
  private readonly shrink = new THREE.Matrix4()
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)
  private readonly material: THREE.MeshStandardMaterial

  constructor() {
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })
    // A little light of its own colour, as the herds and ruins have: a stack
    // seen against the sun is nearly all shaded side, and the scene's sky
    // light made that side blue — a row of blue posts standing in the sea.
    // Weathered as the ruins are (weathered.ts): a little grass and lichen
    // on the tops, dark and wet at the foot where the sea works at it.
    weather(this.material, {
      rough: 0.05,
      // Soft and broad: at 0.3 and a finer grain a stack read as camouflage print.
      mottle: 0.14,
      grain: 4000,
      top: { colour: [0.36, 0.42, 0.24], amount: 0.45 },
      foot: { dark: 0.4, height: 0.15 },
      own: 0.35,
    })
    this.pillars = new THREE.InstancedMesh(pillarGeometry(), this.material, MOST_GROUPS * PIECES)
    this.pillars.frustumCulled = false
    this.pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let k = 0; k < MOST_GROUPS * PIECES; k += 1) this.pillars.setMatrixAt(k, this.gone)
    for (let k = 0; k < MOST_GROUPS; k += 1)
      this.placed.push({ matrices: [], sprays: [], at: [0, 0, 1], home: [0, 0, 1] })
    const count = MOST_GROUPS * PIECES * SPRAY
    this.sprayAt = new Float32Array(count * 3)
    this.sprayOf = new Float32Array(count * 4)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.sprayAt, 3))
    geometry.setAttribute('sprayOf', new THREE.BufferAttribute(this.sprayOf, 4))
    this.spray = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { sprayTime: DETAIL_TIME },
        vertexShader: /* glsl */ `
          uniform float sprayTime;
          attribute vec4 sprayOf;
          varying float vAlpha;
          void main() {
            // sprayOf: x the pillar's radius, y a seed, z how far round it,
            // w shown (0 to 1). Each speck bursts up and out from the foot
            // of its pillar when its wave arrives, and falls back.
            float wave = fract(sprayTime * (0.18 + 0.06 * fract(sprayOf.y * 7.0)) + sprayOf.y);
            float burst = smoothstep(0.0, 0.05, wave) * (1.0 - smoothstep(0.05, 0.4, wave));
            float t = clamp(wave / 0.4, 0.0, 1.0);
            vec3 up = normalize(position);
            vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
            vec3 north = cross(up, east);
            vec3 round = cos(sprayOf.z) * east + sin(sprayOf.z) * north;
            float rise = sin(t * 3.14159) * (0.0004 + 0.0004 * fract(sprayOf.y * 13.0));
            vec3 p = position + round * sprayOf.x * (1.1 + t * 1.6) + up * rise;
            vec4 view = modelViewMatrix * vec4(p, 1.0);
            vAlpha = burst * sprayOf.w;
            gl_PointSize = vAlpha > 0.01 ? clamp(0.00012 / max(-view.z, 1e-6) * 900.0, 1.5, 8.0) : 0.0;
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() {
            float spot = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
            if (spot * vAlpha < 0.01) discard;
            gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), spot * vAlpha * 0.8);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    this.spray.frustumCulled = false
    this.spray.renderOrder = 2
    this.group.add(this.pillars, this.spray)
    this.group.matrixAutoUpdate = false
    this.group.visible = false
  }

  /** A new world: its own rocks, of its own high ground's colour. */
  setWorld(world: Planet): void {
    this.world = world
    this.near.reset()
    for (let s = 0; s < MOST_GROUPS; s += 1) this.clear(s)
    this.material.color.copy(fromPalette(world.palette.highland)).multiplyScalar(0.8)
  }

  /** Follow the eye: `eye` in the planet's frame, in radii; `ground` the planet's matrix. */
  update(eye: Vec3, ground: THREE.Matrix4): void {
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    this.group.visible = this.world !== undefined && !this.world.molten && length - 1 < HIGHEST_EYE
    if (!this.group.visible) return
    this.group.matrix.copy(ground)
    this.group.matrixWorld.copy(ground)
    this.group.updateMatrixWorld(true)
    this.near.near(cellOf(eye))
    const under: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
    this.placed.forEach((slot, s) => {
      const away = Math.acos(
        Math.min(1, slot.at[0] * under[0] + slot.at[1] * under[1] + slot.at[2] * under[2]),
      )
      // Gone too by its cell's centre: the search for a coast can carry a
      // group half a cell outside its own, past the rings of cells
      // `NearCells` is sure to hold, where it could be met part-grown.
      const home = Math.acos(
        Math.min(1, slot.home[0] * under[0] + slot.home[1] * under[1] + slot.home[2] * under[2]),
      )
      const shown = Math.min(
        1 - smooth(SHRINK_FROM, GONE_AT, away),
        1 - smooth(HOME_FROM, HOME_GONE, home),
      )
      for (let k = 0; k < PIECES; k += 1) {
        const at = s * PIECES + k
        const rest = slot.matrices[k]
        const sprays = rest !== undefined && slot.sprays[k] === true
        for (let j = 0; j < SPRAY; j += 1)
          this.sprayOf[(at * SPRAY + j) * 4 + 3] = sprays ? shown : 0
        if (rest === undefined || shown <= 0) {
          this.pillars.setMatrixAt(at, this.gone)
          continue
        }
        // Sunk towards its foot on the sea bed, so it goes under the water.
        this.shrink.makeScale(1, shown, 1)
        this.matrix.copy(rest).multiply(this.shrink)
        this.pillars.setMatrixAt(at, this.matrix)
      }
    })
    this.pillars.instanceMatrix.needsUpdate = true
    drawOnlyLive(this.pillars)
    const sprayOf = this.spray.geometry.getAttribute('sprayOf')
    sprayOf.needsUpdate = true
  }

  private build(slot: number, rocks: Rocks): void {
    const world = this.world
    const placed = this.placed[slot]
    if (world === undefined || placed === undefined) return
    placed.at = rocks.shore
    placed.matrices = []
    placed.sprays = []
    const pillar = (
      at: Vec3,
      height: number,
      radius: number,
      lean: number,
      spray: boolean,
    ): void => {
      const up = new THREE.Vector3(...at)
      // From the bed, but never more than a little under the surface: the
      // shallows are clear, and a stack standing from a bed thirty times its
      // height above the water read as a pile driven into the sea.
      const floor = Math.max(
        Math.min(floorRadiusAt(world, at), SEA_RADIUS - 0.0002),
        SEA_RADIUS - 0.0009,
      )
      const tall = SEA_RADIUS - floor + height
      const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
      const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lean * 9)
      const tilt = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        (lean - 0.5) * 0.12,
      )
      turn.multiply(spin).multiply(tilt)
      placed.matrices.push(
        new THREE.Matrix4().compose(
          up.clone().multiplyScalar(floor),
          turn,
          new THREE.Vector3(radius, tall, radius),
        ),
      )
      placed.sprays.push(spray)
      if (!spray) return
      const k = slot * PIECES + placed.matrices.length - 1
      for (let j = 0; j < SPRAY; j += 1) {
        const v = (k * SPRAY + j) * 3
        this.sprayAt[v] = at[0] * SEA_RADIUS
        this.sprayAt[v + 1] = at[1] * SEA_RADIUS
        this.sprayAt[v + 2] = at[2] * SEA_RADIUS
        const o = (k * SPRAY + j) * 4
        this.sprayOf[o] = radius
        this.sprayOf[o + 1] = fract(lean * 31.7 + j * 0.137)
        this.sprayOf[o + 2] = (j / SPRAY) * Math.PI * 2 + lean * 6
      }
    }
    rocks.stacks.forEach((stack, k) => {
      pillar(stack.at, stack.height, stack.radius, fract(rocks.seed * 17 + k * 0.31), true)
    })
    if (rocks.arch !== undefined) {
      const { from, to, height } = rocks.arch
      pillar(from, height, 0.00042, fract(rocks.seed * 5), true)
      pillar(to, height, 0.00042, fract(rocks.seed * 9), true)
      // The span: a block laid across the two feet's tops.
      const a = new THREE.Vector3(...from)
      const b = new THREE.Vector3(...to)
      const middle = a.clone().add(b).normalize()
      const top = SEA_RADIUS + height - 0.00034
      const along = b.clone().sub(a)
      const span = along.length()
      along.addScaledVector(middle, -along.dot(middle)).normalize()
      const side = new THREE.Vector3().crossVectors(middle, along).normalize()
      const turn = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(side, middle, along),
      )
      placed.matrices.push(
        new THREE.Matrix4().compose(
          middle.clone().multiplyScalar(top),
          turn,
          // Thick and long enough to bury its ends in the legs: thin, the arch
          // read as a table.
          new THREE.Vector3(0.0005, 0.0005, span + 0.0007),
        ),
      )
      placed.sprays.push(false)
    }
    const sprayAt = this.spray.geometry.getAttribute('position')
    sprayAt.needsUpdate = true
  }

  private clear(slot: number): void {
    const placed = this.placed[slot]
    if (placed !== undefined) {
      placed.matrices = []
      placed.sprays = []
    }
    for (let k = slot * PIECES * SPRAY; k < (slot + 1) * PIECES * SPRAY; k += 1)
      this.sprayOf[k * 4 + 3] = 0
  }
}

/**
 * A pillar of rock from y = 0 to 1, about unit wide: seven sides, jagged
 * and narrowing as it rises, with a broken top. Two sides a little in from
 * the others so it is not a turned post.
 */
function pillarGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.3, 0.62, 1, 7, 5).translate(0, 0.5, 0)
  const p = geometry.getAttribute('position')
  for (let k = 0; k < p.count; k += 1) {
    const x = p.getX(k)
    const y = p.getY(k)
    const z = p.getZ(k)
    const a = Math.atan2(z, x)
    const ring = Math.round(y * 5)
    const jag =
      0.82 + 0.3 * fract(Math.sin(ring * 12.9898 + Math.round(a * 1.11) * 78.233) * 43758.5453)
    // The top is broken: its middle a little lower than its rim on one side.
    const top = y > 0.99 ? -0.06 * Math.max(0, Math.cos(a)) : 0
    p.setXYZ(k, x * jag, y + top, z * jag)
  }
  geometry.computeVertexNormals()
  return geometry
}

const fract = (x: number): number => x - Math.floor(x)

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
