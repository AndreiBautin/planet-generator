import * as THREE from 'three'

import {
  airshipIn,
  balloonsIn,
  MOST_BALLOONS,
  type Airship,
  type Balloons,
} from '@/generation/aircraft'
import type { Vec3 } from '@/generation/cube'
import { cellOf } from '@/generation/hydrology'
import { around } from '@/generation/oases'
import type { Planet } from '@/generation/planet'

import { NearCells } from './near-cells'
import { drawOnlyLive } from './instances'
import { groundRadiusAt } from './patches/patch-data'

/** The most balloon meets and airships drawn at once. */
const MOST_MEETS = 12
const MOST_SHIPS = 8
/**
 * Where they shrink away, in radians from the eye, measured from the point
 * each is anchored to — always inside its own cell, so inside the rings
 * of cells `NearCells` holds (`HELD_REACH`, 0.026) whenever it is drawn at all.
 */
const SHRINK_FROM = 0.015
const GONE_AT = 0.023
/** Above this height there is nothing here to look for. */
const HIGHEST_EYE = 0.08
/** A balloon's envelope radius and an airship's half length, in radii: larger than life. */
const BALLOON = 0.00045
const AIRSHIP = 0.0016
/** How high over the ground, in radii: the lowest, and how much higher each may be. */
const BALLOON_LOW = 0.0035
const BALLOON_SPREAD = 0.003
const SHIP_LOW = 0.006
const SHIP_SPREAD = 0.003
/** An airship's round, in radians from its anchor, and how long it takes, in seconds. */
const SHIP_ROUND = 0.0035
const SHIP_PERIOD = 260
/** Envelope colours: a balloon's gores alternate between a pair. */
const GORES: readonly (readonly [number, number])[] = [
  [0xd8302a, 0xf2d24a],
  [0x2a5bd8, 0xf2f2ea],
  [0x2f9a4a, 0xf2d24a],
  [0x8a2ad0, 0xf29a2a],
  [0xf26a1a, 0x2a2a3a],
  [0xe8e8e0, 0xd8302a],
  [0x1aa6b8, 0xf2f2ea],
  [0xd83c8a, 0x3a2a8a],
]
const SHIP_HULLS = [0xc8c8c0, 0xd8cfb0, 0x9a3a30, 0x7a8a5a, 0x5a6a7a]

interface Meet {
  at: Vec3
  balloons: {
    /** Radius of its drift round the meet's point, its starting angle, its pace (signed), its height. */
    round: number
    start: number
    pace: number
    radius: number
    seed: number
  }[]
}

interface Ship {
  at: Vec3
  radius: number
  start: number
  way: number
  seed: number
}

/**
 * Things in the sky (generation/aircraft.ts): meets of hot-air balloons
 * drifting slowly round over the land, each in gores of two colours that
 * turn as it goes, its burner firing now and then — a flare at the mouth
 * that lights the basket at night — and airships cruising a slow round,
 * the gondola's windows lit after dusk. Moved on the page by the shared
 * clock, as the caravans are, and kept to the cells round the eye by
 * `NearCells`, shrinking away well inside its reach.
 */
export class Aircraft {
  readonly group = new THREE.Group()
  private readonly goresA: THREE.InstancedMesh
  private readonly goresB: THREE.InstancedMesh
  private readonly baskets: THREE.InstancedMesh
  private readonly flames: THREE.InstancedMesh
  private readonly ships: THREE.InstancedMesh
  private readonly windows: THREE.InstancedMesh
  private readonly meets: (Meet | undefined)[] = new Array<Meet | undefined>(MOST_MEETS).fill(
    undefined,
  )
  private readonly fleet: (Ship | undefined)[] = new Array<Ship | undefined>(MOST_SHIPS).fill(
    undefined,
  )
  private readonly nearMeets = new NearCells<Balloons>(
    MOST_MEETS,
    (cell) => (this.world === undefined ? undefined : balloonsIn(this.world, cell)),
    (slot, _cell, meet) => {
      this.buildMeet(slot, meet)
    },
    (slot) => {
      this.meets[slot] = undefined
    },
  )
  private readonly nearShips = new NearCells<Airship>(
    MOST_SHIPS,
    (cell) => (this.world === undefined ? undefined : airshipIn(this.world, cell)),
    (slot, _cell, ship) => {
      this.buildShip(slot, ship)
    },
    (slot) => {
      this.fleet[slot] = undefined
    },
  )
  private world: Planet | undefined
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0)
  private readonly matrix = new THREE.Matrix4()
  private readonly basis = new THREE.Matrix4()
  private readonly turn = new THREE.Quaternion()
  private readonly up = new THREE.Vector3()
  private readonly ahead = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly place = new THREE.Vector3()
  private readonly size = new THREE.Vector3()
  private readonly sunHere = new THREE.Vector3()
  private readonly colour = new THREE.Color()

  private light(mesh: THREE.InstancedMesh, at: number, own: number, burn: number): void {
    const light = mesh.geometry.getAttribute('craftLight')
    light.setXY(at, own, burn)
  }

  constructor() {
    // Each lit by the scene with a little light of its own colour, as the
    // herds are, so their shaded sides are not the sky's blue — but only by
    // day: at night that light made them glow against black ground. And an
    // envelope glows orange from inside while its burner fires.
    const lit = (material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          'attribute vec2 craftLight;\nvarying vec2 vCraftLight;\nvoid main() {\n  vCraftLight = craftLight;',
        )
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'varying vec2 vCraftLight;\nvoid main() {')
          .replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * (vCraftLight.x + vec3(1.0, 0.62, 0.32) * vCraftLight.y * 1.8);',
          )
      }
      return material
    }
    const balloons = MOST_MEETS * MOST_BALLOONS
    const envelope = (): THREE.MeshStandardMaterial =>
      lit(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }))
    this.goresA = new THREE.InstancedMesh(envelopeGeometry(0), envelope(), balloons)
    this.goresB = new THREE.InstancedMesh(envelopeGeometry(1), envelope(), balloons)
    this.baskets = new THREE.InstancedMesh(
      basketGeometry(),
      lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })),
      balloons,
    )
    this.flames = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.09, 0.42, 5).translate(0, 0.21, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.22), toneMapped: false }),
      balloons,
    )
    this.ships = new THREE.InstancedMesh(
      airshipGeometry(),
      lit(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true }),
      ),
      MOST_SHIPS,
    )
    this.windows = new THREE.InstancedMesh(
      windowGeometry(),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.78, 0.4), toneMapped: false }),
      MOST_SHIPS,
    )
    for (const mesh of [this.goresA, this.goresB, this.baskets, this.ships]) {
      const light = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 2), 2)
      light.setUsage(THREE.DynamicDrawUsage)
      mesh.geometry.setAttribute('craftLight', light)
    }
    for (const mesh of [
      this.goresA,
      this.goresB,
      this.baskets,
      this.flames,
      this.ships,
      this.windows,
    ]) {
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      for (let k = 0; k < mesh.count; k += 1) mesh.setMatrixAt(k, this.gone)
      this.group.add(mesh)
    }
    // Each balloon its own pair of colours, each airship its own hull.
    for (let k = 0; k < balloons; k += 1) {
      const pair = GORES[(k * 5 + Math.floor(k / MOST_BALLOONS) * 3) % GORES.length] ?? [0, 0]
      this.goresA.setColorAt(k, this.colour.setHex(pair[0]))
      this.goresB.setColorAt(k, this.colour.setHex(pair[1]))
    }
    for (let k = 0; k < MOST_SHIPS; k += 1) {
      this.ships.setColorAt(k, this.colour.setHex(SHIP_HULLS[k % SHIP_HULLS.length] ?? 0xcccccc))
    }
    this.group.matrixAutoUpdate = false
    this.group.visible = false
  }

  /** A new world: its own sky. */
  setWorld(world: Planet): void {
    this.world = world
    this.nearMeets.reset()
    this.nearShips.reset()
    this.meets.fill(undefined)
    this.fleet.fill(undefined)
  }

  /**
   * Follow the eye: `eye` in the planet's frame, in radii; `ground` the
   * planet's matrix; `sun` the direction to the sun in the planet's frame;
   * `seconds` the shared clock.
   */
  update(eye: Vec3, ground: THREE.Matrix4, sun: THREE.Vector3, seconds: number): void {
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    this.group.visible = this.world !== undefined && !this.world.molten && length - 1 < HIGHEST_EYE
    if (!this.group.visible) return
    this.group.matrix.copy(ground)
    this.group.matrixWorld.copy(ground)
    this.group.updateMatrixWorld(true)
    const cell = cellOf(eye)
    this.nearMeets.near(cell)
    this.nearShips.near(cell)
    this.sunHere.copy(sun).normalize()
    const under: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
    const shownAt = (at: Vec3): number =>
      1 - smooth(SHRINK_FROM, GONE_AT, Math.acos(Math.min(1, dot(at, under))))
    this.meets.forEach((meet, s) => {
      const shown = meet === undefined ? 0 : shownAt(meet.at)
      for (let k = 0; k < MOST_BALLOONS; k += 1) {
        const at = s * MOST_BALLOONS + k
        const balloon = meet?.balloons[k]
        if (meet === undefined || balloon === undefined || shown <= 0) {
          for (const mesh of [this.goresA, this.goresB, this.baskets, this.flames]) {
            mesh.setMatrixAt(at, this.gone)
          }
          continue
        }
        // Drifting slowly round the meet's point, rising and sinking a
        // little, and turning on its rope as balloons do.
        const here = around(meet.at, balloon.round, balloon.start + seconds * balloon.pace)
        const rise = Math.sin(seconds * 0.11 + balloon.seed * 40) * 0.0004
        this.up.set(...here)
        this.place.copy(this.up).multiplyScalar(balloon.radius + rise)
        this.ahead.set(1, 0, 0).cross(this.up)
        if (this.ahead.lengthSq() < 1e-6) this.ahead.set(0, 0, 1).cross(this.up)
        this.ahead.normalize().applyAxisAngle(this.up, seconds * 0.04 + balloon.seed * 20)
        this.side.crossVectors(this.up, this.ahead).normalize()
        this.basis.makeBasis(this.side, this.up, this.ahead)
        this.turn.setFromRotationMatrix(this.basis)
        this.size.setScalar(BALLOON * shown)
        this.matrix.compose(this.place, this.turn, this.size)
        this.goresA.setMatrixAt(at, this.matrix)
        this.goresB.setMatrixAt(at, this.matrix)
        this.baskets.setMatrixAt(at, this.matrix)
        // The burner fires for a breath every so often, each balloon on its own beat.
        const beat = (seconds / (7 + balloon.seed * 6) + balloon.seed * 3) % 1
        const firing = beat < 0.18 ? Math.sin((beat / 0.18) * Math.PI) : 0
        const flicker = 0.8 + 0.2 * Math.sin(seconds * 31 + balloon.seed * 90)
        const day = smooth(-0.1, 0.15, this.up.dot(this.sunHere))
        const burn = firing * flicker * (0.15 + 0.6 * (1 - day))
        this.light(this.goresA, at, 0.3 * (0.2 + 0.8 * day), burn)
        this.light(this.goresB, at, 0.3 * (0.2 + 0.8 * day), burn)
        this.light(this.baskets, at, 0.3 * (0.2 + 0.8 * day), burn * 0.5)
        if (firing <= 0.02) {
          this.flames.setMatrixAt(at, this.gone)
        } else {
          // Standing on the burner, just under the mouth, grown upwards.
          this.size.set(BALLOON * shown, BALLOON * shown * firing * flicker, BALLOON * shown)
          this.side.copy(this.place).addScaledVector(this.up, -1.5 * BALLOON * shown)
          this.matrix.compose(this.side, this.turn, this.size)
          this.flames.setMatrixAt(at, this.matrix)
        }
      }
    })
    this.fleet.forEach((ship, s) => {
      const shown = ship === undefined ? 0 : shownAt(ship.at)
      if (ship === undefined || shown <= 0) {
        this.ships.setMatrixAt(s, this.gone)
        this.windows.setMatrixAt(s, this.gone)
        return
      }
      // A slow round of its patch of sky, nose along the way it goes.
      const angle = ship.start + (seconds / SHIP_PERIOD) * Math.PI * 2 * ship.way
      const here = around(ship.at, SHIP_ROUND, angle)
      const next = around(ship.at, SHIP_ROUND, angle + 0.02 * ship.way)
      this.up.set(...here)
      this.ahead.set(next[0] - here[0], next[1] - here[1], next[2] - here[2])
      this.ahead.addScaledVector(this.up, -this.ahead.dot(this.up)).normalize()
      // Nosing gently up and down as it rides the air.
      this.ahead
        .addScaledVector(this.up, Math.sin(seconds * 0.23 + ship.seed * 30) * 0.03)
        .normalize()
      this.side.crossVectors(this.up, this.ahead).normalize()
      const lift = this.up.clone().crossVectors(this.ahead, this.side).normalize()
      this.basis.makeBasis(this.side, lift, this.ahead)
      this.turn.setFromRotationMatrix(this.basis)
      this.place.copy(this.up).multiplyScalar(ship.radius)
      this.size.setScalar(AIRSHIP * shown)
      this.matrix.compose(this.place, this.turn, this.size)
      this.ships.setMatrixAt(s, this.matrix)
      // The gondola lit after dusk.
      const sunUp = this.up.dot(this.sunHere)
      this.light(this.ships, s, 0.15 * (0.2 + 0.8 * smooth(-0.1, 0.15, sunUp)), 0)
      this.windows.setMatrixAt(s, sunUp < 0 ? this.matrix : this.gone)
    })
    for (const mesh of [
      this.goresA,
      this.goresB,
      this.baskets,
      this.flames,
      this.ships,
      this.windows,
    ]) {
      mesh.instanceMatrix.needsUpdate = true
      drawOnlyLive(mesh)
    }
    for (const mesh of [this.goresA, this.goresB, this.baskets, this.ships]) {
      mesh.geometry.getAttribute('craftLight').needsUpdate = true
    }
  }

  /** The highest ground under a round of `round` radians about `at`, so nothing flies into a hill. */
  private highestUnder(at: Vec3, round: number): number {
    const world = this.world
    if (world === undefined) return 1
    let highest = groundRadiusAt(world, at)
    for (let k = 0; k < 12; k += 1) {
      highest = Math.max(highest, groundRadiusAt(world, around(at, round, (k * Math.PI) / 6)))
      highest = Math.max(
        highest,
        groundRadiusAt(world, around(at, round * 0.5, (k * Math.PI) / 6 + 0.26)),
      )
    }
    return highest
  }

  private buildMeet(slot: number, meet: Balloons): void {
    const balloons: Meet['balloons'] = []
    const widest = 0.0032
    const floor = this.highestUnder(meet.at, widest)
    for (let k = 0; k < meet.balloons; k += 1) {
      const seed = (meet.seed * 7.31 + k * 0.618) % 1
      balloons.push({
        round: 0.0008 + ((seed * 13.7) % 1) * (widest - 0.0008),
        start: seed * Math.PI * 2 + k * 1.7,
        // All with one wind, each at its own pace: a turn in ten minutes or so.
        pace: (meet.seed < 0.5 ? 1 : -1) * (0.008 + ((seed * 5.3) % 1) * 0.006),
        radius: floor + BALLOON_LOW + ((seed * 3.9) % 1) * BALLOON_SPREAD,
        seed,
      })
    }
    this.meets[slot] = { at: meet.at, balloons }
  }

  private buildShip(slot: number, ship: Airship): void {
    const floor = this.highestUnder(ship.at, SHIP_ROUND)
    this.fleet[slot] = {
      at: ship.at,
      radius: floor + SHIP_LOW + ship.seed * SHIP_SPREAD,
      start: ship.seed * Math.PI * 2,
      way: ship.seed < 0.5 ? 1 : -1,
      seed: ship.seed,
    }
  }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Geometries flattened and joined, each part with a colour if given. */
function joined(
  parts: { geometry: THREE.BufferGeometry; colour?: readonly number[] }[],
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colours: number[] = []
  for (const { geometry, colour } of parts) {
    const flat = geometry.index === null ? geometry : geometry.toNonIndexed()
    const position = flat.getAttribute('position')
    const normal = flat.getAttribute('normal')
    for (let k = 0; k < position.count; k += 1) {
      positions.push(position.getX(k), position.getY(k), position.getZ(k))
      normals.push(normal.getX(k), normal.getY(k), normal.getZ(k))
      colours.push(...(colour ?? [1, 1, 1]))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  return geometry
}

/**
 * Half a balloon's envelope, a unit in radius: the even gores or the odd,
 * twelve in all, so each half takes its own colour. A teardrop, the mouth
 * at the bottom (y −1.3) narrow over the burner.
 */
function envelopeGeometry(parity: 0 | 1): THREE.BufferGeometry {
  const profile = [
    [0.2, -1.32],
    [0.34, -1.12],
    [0.66, -0.66],
    [0.92, -0.18],
    [1, 0.22],
    [0.92, 0.58],
    [0.68, 0.86],
    [0.36, 1.0],
    [0, 1.04],
  ].map(([x = 0, y = 0]) => new THREE.Vector2(x, y))
  const gores = 12
  const parts: { geometry: THREE.BufferGeometry }[] = []
  for (let k = parity; k < gores; k += 2) {
    parts.push({
      geometry: new THREE.LatheGeometry(
        profile,
        2,
        (k / gores) * Math.PI * 2,
        (Math.PI * 2) / gores,
      ),
    })
  }
  const geometry = joined(parts)
  geometry.deleteAttribute('color')
  return geometry
}

/** A balloon's basket and its ropes up to the mouth, in the envelope's units. */
function basketGeometry(): THREE.BufferGeometry {
  const wicker = [0.36, 0.22, 0.1]
  const rope = [0.12, 0.1, 0.08]
  const parts: { geometry: THREE.BufferGeometry; colour?: readonly number[] }[] = [
    { geometry: new THREE.BoxGeometry(0.3, 0.22, 0.3).translate(0, -1.86, 0), colour: wicker },
    { geometry: new THREE.BoxGeometry(0.12, 0.05, 0.12).translate(0, -1.5, 0), colour: rope },
  ]
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    // A rope from the basket's corner to the mouth's rim.
    const from = new THREE.Vector3(x * 0.14, -1.76, z * 0.14)
    const to = new THREE.Vector3(x * 0.14, -1.32, z * 0.14)
    const middle = from.clone().add(to).multiplyScalar(0.5)
    parts.push({
      geometry: new THREE.BoxGeometry(0.018, from.distanceTo(to), 0.018).translate(
        middle.x,
        middle.y,
        middle.z,
      ),
      colour: rope,
    })
  }
  return joined(parts)
}

/** An airship, a unit long each way from the middle, nose to +z: hull, fins, gondola and engines. */
function airshipGeometry(): THREE.BufferGeometry {
  const hull = [0.95, 0.95, 0.95]
  const fin = [0.55, 0.55, 0.55]
  const cabin = [0.22, 0.18, 0.14]
  return joined([
    { geometry: new THREE.SphereGeometry(1, 14, 8).scale(0.26, 0.26, 1), colour: hull },
    { geometry: new THREE.BoxGeometry(0.02, 0.62, 0.26).translate(0, 0, -0.8), colour: fin },
    { geometry: new THREE.BoxGeometry(0.62, 0.02, 0.26).translate(0, 0, -0.8), colour: fin },
    { geometry: new THREE.BoxGeometry(0.1, 0.08, 0.36).translate(0, -0.3, 0.08), colour: cabin },
    {
      geometry: new THREE.BoxGeometry(0.06, 0.06, 0.12).translate(0.2, -0.24, -0.22),
      colour: cabin,
    },
    {
      geometry: new THREE.BoxGeometry(0.06, 0.06, 0.12).translate(-0.2, -0.24, -0.22),
      colour: cabin,
    },
  ])
}

/** An airship's gondola windows, a row each side, in its units. */
function windowGeometry(): THREE.BufferGeometry {
  const parts: { geometry: THREE.BufferGeometry }[] = []
  for (const side of [1, -1]) {
    for (let k = 0; k < 4; k += 1) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.004, 0.025, 0.04).translate(
          side * 0.052,
          -0.295,
          -0.05 + k * 0.08,
        ),
      })
    }
  }
  const geometry = joined(parts)
  geometry.deleteAttribute('color')
  return geometry
}
