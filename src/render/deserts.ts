import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { cellOf } from '@/generation/hydrology'
import { around, caravanIn, oasisIn, type Caravan, type Oasis } from '@/generation/oases'
import type { Planet } from '@/generation/planet'

import { DETAIL_TIME } from './detail'
import { NearCells } from './near-cells'
import { groundRadiusAt } from './patches/patch-data'

/** The most oases and caravans drawn at once. */
const MOST_OASES = 16
const MOST_CARAVANS = 16
const MOST_PALMS = 16
const MOST_CAMELS = 8
/** Where things shrink away into the sand, in radians from the eye. */
const SHRINK_FROM = 0.02
const GONE_AT = 0.03
/** Above this height there is nothing here to look for. */
const HIGHEST_EYE = 0.06
/** A palm's height and a camel's length, in radii: larger than life, as the trees and herds are. */
const PALM = 0.0009
const CAMEL = 0.00024
/** How fast a caravan walks, radians a second, and how far apart its camels go. */
const WALK = 0.00016
const SPACING = 0.0004
/** Points along a caravan's way, the ground measured at each once. */
const WAY = 64
/**
 * How far round each point the ground is felt, in radians — about the
 * drawn mesh's vertex spacing — and how rough a way may be before a caravan
 * will not take it. The mesh runs straight between its vertices, so on a
 * steep dune face it can stand well above the true height between them;
 * taking the highest ground near each point keeps a camel above whatever
 * is drawn, and keeping caravans off rough ground keeps that from floating.
 */
const FEEL = 0.0003
const ROUGHEST = 0.0006

interface Placed {
  at: Vec3
  matrices: THREE.Matrix4[]
}

interface Way {
  points: Vec3[]
  length: number
  camels: number
  seed: number
}

/**
 * Life in the deserts (generation/oases.ts): oases — a still pool in a ring
 * of green with palms leaning round it — and caravans, a string of camels
 * plodding there and back across the sand by the shared clock. Kept to the
 * cells round the eye by `NearCells`, each built where the ground was
 * measured for it when it came near, shrinking away at the edge of reach.
 * Lit by the scene, with the little light of their own colour the herds
 * have, so their shaded sides are not the sky's blue.
 */
export class Deserts {
  readonly group = new THREE.Group()
  private readonly pools: THREE.InstancedMesh
  private readonly greens: THREE.InstancedMesh
  private readonly palms: THREE.InstancedMesh
  private readonly camels: THREE.InstancedMesh
  private readonly oases: Placed[] = []
  private readonly caravans: (Way | undefined)[] = new Array<Way | undefined>(MOST_CARAVANS).fill(
    undefined,
  )
  private readonly nearOases = new NearCells<Oasis>(
    MOST_OASES,
    (cell) => (this.world === undefined ? undefined : oasisIn(this.world, cell)),
    (slot, _cell, oasis) => {
      this.buildOasis(slot, oasis)
    },
    (slot) => {
      const placed = this.oases[slot]
      if (placed !== undefined) placed.matrices = []
    },
  )
  private readonly nearCaravans = new NearCells<Caravan>(
    MOST_CARAVANS,
    (cell) => (this.world === undefined ? undefined : caravanIn(this.world, cell)),
    (slot, _cell, caravan) => {
      this.buildCaravan(slot, caravan)
    },
    (slot) => {
      this.caravans[slot] = undefined
    },
  )
  private world: Planet | undefined
  private readonly matrix = new THREE.Matrix4()
  private readonly shrink = new THREE.Matrix4()
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)
  private readonly basis = new THREE.Matrix4()
  private readonly turn = new THREE.Quaternion()
  private readonly up = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly place = new THREE.Vector3()
  private readonly size = new THREE.Vector3()

  constructor() {
    const lit = (material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.25;',
        )
      }
      return material
    }
    const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2)
    this.greens = new THREE.InstancedMesh(
      disc,
      lit(
        new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.32, 0.1), roughness: 1 }),
      ),
      MOST_OASES,
    )
    this.pools = new THREE.InstancedMesh(disc, poolMaterial(), MOST_OASES)
    this.palms = new THREE.InstancedMesh(
      palmGeometry(),
      lit(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
      ),
      MOST_OASES * MOST_PALMS,
    )
    this.camels = new THREE.InstancedMesh(
      camelGeometry(),
      lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })),
      MOST_CARAVANS * MOST_CAMELS,
    )
    for (const mesh of [this.greens, this.pools, this.palms, this.camels]) {
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      for (let k = 0; k < mesh.count; k += 1) mesh.setMatrixAt(k, this.gone)
      this.group.add(mesh)
    }
    this.pools.renderOrder = 1
    for (let k = 0; k < MOST_OASES; k += 1) this.oases.push({ at: [0, 0, 1], matrices: [] })
    this.group.matrixAutoUpdate = false
    this.group.visible = false
  }

  /** A new world: its own deserts. */
  setWorld(world: Planet): void {
    this.world = world
    this.nearOases.reset()
    this.nearCaravans.reset()
    for (const placed of this.oases) placed.matrices = []
    this.caravans.fill(undefined)
  }

  /** Follow the eye: `eye` in the planet's frame, in radii; `ground` the planet's matrix; `seconds` the clock. */
  update(eye: Vec3, ground: THREE.Matrix4, seconds: number): void {
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    this.group.visible = this.world !== undefined && !this.world.molten && length - 1 < HIGHEST_EYE
    if (!this.group.visible) return
    this.group.matrix.copy(ground)
    this.group.matrixWorld.copy(ground)
    this.group.updateMatrixWorld(true)
    const cell = cellOf(eye)
    this.nearOases.near(cell)
    this.nearCaravans.near(cell)
    const under: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
    const shownAt = (at: Vec3): number =>
      1 - smooth(SHRINK_FROM, GONE_AT, Math.acos(Math.min(1, dot(at, under))))
    this.oases.forEach((placed, s) => {
      const shown = placed.matrices.length === 0 ? 0 : shownAt(placed.at)
      const [green, pool, ...palms] = placed.matrices
      this.set(this.greens, s, green, shown, false)
      this.set(this.pools, s, pool, shown, false)
      for (let k = 0; k < MOST_PALMS; k += 1)
        this.set(this.palms, s * MOST_PALMS + k, palms[k], shown, true)
    })
    this.caravans.forEach((way, s) => {
      for (let k = 0; k < MOST_CAMELS; k += 1) {
        const at = s * MOST_CAMELS + k
        if (way === undefined || k >= way.camels) {
          this.camels.setMatrixAt(at, this.gone)
          continue
        }
        // There and back along its way, each camel a little behind the one before.
        const run = (seconds * WALK) / way.length + way.seed * 2
        const phase = run % 2
        const forward = phase < 1
        const lead = (forward ? phase : 2 - phase) * way.length
        const d = Math.min(way.length, Math.max(0, lead + (forward ? -1 : 1) * k * SPACING))
        const here = pointOn(way, d)
        const next = pointOn(
          way,
          Math.min(way.length, Math.max(0, d + (forward ? 1 : -1) * 0.0002)),
        )
        const shown = shownAt(here)
        if (shown <= 0) {
          this.camels.setMatrixAt(at, this.gone)
          continue
        }
        this.up.set(...here).normalize()
        this.ahead.set(next[0] - here[0], next[1] - here[1], next[2] - here[2])
        this.ahead.addScaledVector(this.up, -this.ahead.dot(this.up)).normalize()
        this.side.crossVectors(this.up, this.ahead).normalize()
        this.basis.makeBasis(this.side, this.up, this.ahead)
        this.turn.setFromRotationMatrix(this.basis)
        // A plod: up and down a little with each stride.
        const bob = Math.abs(Math.sin(seconds * 3.2 + k * 1.3)) * CAMEL * 0.05
        this.place.set(...here).addScaledVector(this.up, bob)
        this.size.setScalar(CAMEL * shown)
        this.matrix.compose(this.place, this.turn, this.size)
        this.camels.setMatrixAt(at, this.matrix)
      }
    })
    for (const mesh of [this.greens, this.pools, this.palms, this.camels])
      mesh.instanceMatrix.needsUpdate = true
  }

  /** Put one instance at its resting matrix, shrunk towards its foot by `shown`; `upright` shrinks it all ways. */
  private set(
    mesh: THREE.InstancedMesh,
    at: number,
    rest: THREE.Matrix4 | undefined,
    shown: number,
    upright: boolean,
  ): void {
    if (rest === undefined || shown <= 0) {
      mesh.setMatrixAt(at, this.gone)
      return
    }
    this.shrink.makeScale(shown, upright ? shown : 1, shown)
    this.matrix.copy(rest).multiply(this.shrink)
    mesh.setMatrixAt(at, this.matrix)
  }

  private buildOasis(slot: number, oasis: Oasis): void {
    const world = this.world
    const placed = this.oases[slot]
    if (world === undefined || placed === undefined) return
    placed.at = oasis.at
    placed.matrices = []
    const up = new THREE.Vector3(...oasis.at)
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
    const radius = groundRadiusAt(world, oasis.at)
    // The green ring, then the pool, a hair over the ground so neither is
    // lost in it; on a slope the ground's own rise covers their far edge.
    placed.matrices.push(
      new THREE.Matrix4().compose(
        up.clone().multiplyScalar(radius + 0.00003),
        turn,
        new THREE.Vector3(oasis.pool * 2.4, 1, oasis.pool * 2.4),
      ),
      new THREE.Matrix4().compose(
        up.clone().multiplyScalar(radius + 0.00005),
        turn,
        new THREE.Vector3(oasis.pool, 1, oasis.pool),
      ),
    )
    let h = Math.floor(oasis.seed * 4294967296) | 1
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    for (let k = 0; k < Math.min(MOST_PALMS, oasis.palms); k += 1) {
      const bearing = (k / oasis.palms) * Math.PI * 2 + next() * 0.6
      const at = around(oasis.at, oasis.pool * (1.15 + next() * 0.9), bearing)
      const foot = groundRadiusAt(world, at) - 0.00003
      const pUp = new THREE.Vector3(...at)
      const pTurn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pUp)
      // Each its own height, turned its own way, leaning out over the water or away.
      pTurn.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), next() * Math.PI * 2),
      )
      const tall = PALM * (0.7 + next() * 0.5)
      placed.matrices.push(
        new THREE.Matrix4().compose(
          pUp.multiplyScalar(foot),
          pTurn,
          new THREE.Vector3(tall, tall, tall),
        ),
      )
    }
  }

  private buildCaravan(slot: number, caravan: Caravan): void {
    this.caravans[slot] = undefined
    const world = this.world
    if (world === undefined) return
    const points: Vec3[] = []
    for (let k = 0; k < WAY; k += 1) {
      const t = k / (WAY - 1)
      const p = unit([
        caravan.from[0] * (1 - t) + caravan.to[0] * t,
        caravan.from[1] * (1 - t) + caravan.to[1] * t,
        caravan.from[2] * (1 - t) + caravan.to[2] * t,
      ])
      let highest = groundRadiusAt(world, p)
      let lowest = highest
      for (let turn = 0; turn < 4; turn += 1) {
        const r = groundRadiusAt(world, around(p, FEEL, (turn * Math.PI) / 2))
        highest = Math.max(highest, r)
        lowest = Math.min(lowest, r)
      }
      // Up a dune face and down the next: no caravan goes that way.
      if (highest - lowest > ROUGHEST) return
      points.push([p[0] * highest, p[1] * highest, p[2] * highest])
    }
    const span = Math.acos(Math.min(1, dot(caravan.from, caravan.to)))
    this.caravans[slot] = {
      points,
      length: span,
      camels: Math.min(MOST_CAMELS, caravan.camels),
      seed: caravan.seed,
    }
  }
}

/** The point `distance` along a caravan's way. */
function pointOn(way: Way, distance: number): Vec3 {
  const t = Math.min(1, Math.max(0, distance / way.length)) * (way.points.length - 1)
  const k = Math.min(way.points.length - 2, Math.floor(t))
  const a = way.points[k] ?? [0, 0, 1]
  const b = way.points[k + 1] ?? a
  const f = t - k
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** A still pool, deep in the middle and pale at its rim, catching a slow ripple of light. */
function poolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { poolTime: DETAIL_TIME },
    vertexShader: /* glsl */ `
      varying vec2 vAt;
      void main() {
        vAt = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float poolTime;
      varying vec2 vAt;
      void main() {
        float r = length(vAt);
        vec3 deep = vec3(0.02, 0.18, 0.2);
        vec3 shallow = vec3(0.16, 0.42, 0.36);
        vec3 colour = mix(deep, shallow, smoothstep(0.3, 1.0, r));
        float ripple = sin(r * 18.0 - poolTime * 1.4) * 0.5 + 0.5;
        colour += vec3(0.08, 0.1, 0.1) * ripple * (1.0 - r);
        gl_FragColor = vec4(colour, smoothstep(1.0, 0.85, r));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

/** A palm, one unit tall: a slender trunk curving up, a crown of fronds drooping out. */
function palmGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const bark: [number, number, number] = [0.42, 0.32, 0.2]
  const frond: [number, number, number] = [0.2, 0.42, 0.12]
  const tri = (a: Vec3, b: Vec3, c: Vec3, colour: [number, number, number]): void => {
    positions.push(...a, ...b, ...c)
    for (let k = 0; k < 3; k += 1) colours.push(...colour)
  }
  // The trunk: four segments of a thin square post, bending as it rises.
  const ring = (y: number): Vec3[] => {
    const bend = 0.12 * y * y
    const w = 0.035 * (1 - y * 0.4)
    return [
      [bend - w, y, -w],
      [bend + w, y, -w],
      [bend + w, y, w],
      [bend - w, y, w],
    ]
  }
  for (let s = 0; s < 4; s += 1) {
    const a = ring((s / 4) * 0.9)
    const b = ring(((s + 1) / 4) * 0.9)
    for (let k = 0; k < 4; k += 1) {
      const n = (k + 1) % 4
      const a0 = a[k] ?? [0, 0, 0]
      const a1 = a[n] ?? [0, 0, 0]
      const b0 = b[k] ?? [0, 0, 0]
      const b1 = b[n] ?? [0, 0, 0]
      tri(a0, a1, b1, bark)
      tri(a0, b1, b0, bark)
    }
  }
  // Seven fronds from the crown, each out and down.
  const top: Vec3 = [0.12 * 0.81, 0.9, 0]
  for (let k = 0; k < 7; k += 1) {
    const a = (k / 7) * Math.PI * 2
    const out: Vec3 = [Math.cos(a), 0, Math.sin(a)]
    const across: Vec3 = [-Math.sin(a), 0, Math.cos(a)]
    const mid: Vec3 = [top[0] + out[0] * 0.22, top[1] + 0.06, top[2] + out[2] * 0.22]
    const tip: Vec3 = [top[0] + out[0] * 0.42, top[1] - 0.14, top[2] + out[2] * 0.42]
    const l: Vec3 = [mid[0] + across[0] * 0.07, mid[1], mid[2] + across[2] * 0.07]
    const r: Vec3 = [mid[0] - across[0] * 0.07, mid[1], mid[2] - across[2] * 0.07]
    tri(top, l, r, frond)
    tri(l, tip, r, frond)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** A camel, a unit long, nose to +z: a body, a hump, a long neck and head, four long legs, a rider. */
function camelGeometry(): THREE.BufferGeometry {
  const tan: [number, number, number] = [0.3, 0.17, 0.07]
  const dark: [number, number, number] = [0.17, 0.09, 0.04]
  const cloth: [number, number, number] = [0.1, 0.12, 0.32]
  const parts: [number, number, number, number, number, number, [number, number, number]][] = [
    [0, 0.62, 0, 0.3, 0.24, 0.62, tan],
    [0, 0.82, -0.04, 0.24, 0.18, 0.3, tan],
    [0, 0.82, 0.38, 0.12, 0.36, 0.12, tan],
    [0, 1.0, 0.48, 0.12, 0.12, 0.22, tan],
    [-0.1, 0.25, 0.22, 0.07, 0.5, 0.07, dark],
    [0.1, 0.25, 0.22, 0.07, 0.5, 0.07, dark],
    [-0.1, 0.25, -0.22, 0.07, 0.5, 0.07, dark],
    [0.1, 0.25, -0.22, 0.07, 0.5, 0.07, dark],
    // A rider, robed, on the hump.
    [0, 1.06, -0.04, 0.14, 0.3, 0.14, cloth],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const colours: number[] = []
  for (const [x, y, z, w, h, d, colour] of parts) {
    const box = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed()
    const p = box.getAttribute('position')
    const n = box.getAttribute('normal')
    for (let k = 0; k < p.count; k += 1) {
      positions.push(p.getX(k), p.getY(k), p.getZ(k))
      normals.push(n.getX(k), n.getY(k), n.getZ(k))
      colours.push(...colour)
    }
    box.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  return geometry
}

const dot = (a: Vec3, b: Vec3): number => {
  const la = Math.hypot(a[0], a[1], a[2]) || 1
  const lb = Math.hypot(b[0], b[1], b[2]) || 1
  return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
