import * as THREE from 'three'

import type { Harbours } from '@/generation/harbours'
import type { Planet } from '@/generation/planet'

import { groundRadiusAt } from './patches/patch-data'
import { weather } from './weathered'

/** A lighthouse's height and the width of its foot, in radii: a tall tower over houses 0.0003 high. */
const HEIGHT = 0.0011
const FOOT = 0.00015
/** How far a beam reaches and how wide it spreads at its end, in radii. */
const REACH = 0.014
const SPREAD = 0.0009
/** How fast the light turns, radians a second. */
const TURN = 0.9

const GLASS = new THREE.Color(0.12, 0.14, 0.16)
const LAMP = new THREE.Color(1.6, 1.25, 0.7)

/**
 * Lighthouses: a white tower banded red at each harbour that has a point
 * of shore beside it (generation/harbours.ts), a lantern at the top that
 * lights at dusk, and at night a pair of beams turning round it — the
 * thing that says a coast is lived on from far out at sea.
 *
 * A child of the ground, built once: ninety towers at most, each where the
 * ground was measured for it. Each frame only the lanterns' colour and
 * the beams' turn change, read against the sun from each tower's own place.
 */
export class Lighthouses {
  readonly group = new THREE.Group()
  private readonly towers: THREE.InstancedMesh
  private readonly lanterns: THREE.InstancedMesh
  private readonly beams: THREE.InstancedMesh
  private readonly sites: {
    readonly up: THREE.Vector3
    readonly top: THREE.Vector3
    readonly turn: THREE.Quaternion
  }[] = []
  private readonly matrix = new THREE.Matrix4()
  private readonly spin = new THREE.Quaternion()
  private readonly turned = new THREE.Quaternion()
  private readonly colour = new THREE.Color()
  private readonly size = new THREE.Vector3(1, 1, 1)
  private readonly sunHere = new THREE.Vector3()
  private static readonly Y = new THREE.Vector3(0, 1, 0)

  constructor(harbours: Harbours, world: Planet) {
    for (const harbour of harbours.harbours) {
      if (harbour.light === undefined) continue
      const up = new THREE.Vector3(...harbour.light)
      const foot = groundRadiusAt(world, harbour.light) - 0.00004
      this.sites.push({
        up,
        top: up.clone().multiplyScalar(foot + HEIGHT * 0.93),
        turn: new THREE.Quaternion().setFromUnitVectors(Lighthouses.Y, up),
      })
    }
    const count = Math.max(1, this.sites.length)
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
    // Salt-stained whitewash, grimed at the foot (weathered.ts).
    weather(stone, {
      rough: 0,
      mottle: 0.15,
      grain: 20000,
      foot: { dark: 0.3, height: HEIGHT * 0.15 },
      own: 0.2,
    })
    this.towers = new THREE.InstancedMesh(towerGeometry(), stone, count)
    this.lanterns = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(FOOT * 0.55, FOOT * 0.55, HEIGHT * 0.12, 8).translate(
        0,
        HEIGHT * 0.9,
        0,
      ),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      count,
    )
    this.beams = new THREE.InstancedMesh(beamGeometry(), beamMaterial(), count)
    this.sites.forEach((site, k) => {
      const foot = site.top.length() - HEIGHT * 0.93
      this.matrix.compose(site.up.clone().multiplyScalar(foot), site.turn, this.size)
      this.towers.setMatrixAt(k, this.matrix)
      this.lanterns.setMatrixAt(k, this.matrix)
      this.lanterns.setColorAt(k, GLASS)
      this.beams.setColorAt(k, new THREE.Color(0, 0, 0))
    })
    this.towers.count = this.sites.length
    this.lanterns.count = this.sites.length
    this.beams.count = this.sites.length
    for (const mesh of [this.towers, this.lanterns, this.beams]) {
      mesh.frustumCulled = false
      this.group.add(mesh)
    }
    this.beams.renderOrder = 3
  }

  /**
   * `sun` the direction to the sun in the planet's own frame; `seconds` the
   * shared clock. Lanterns light and beams turn by each tower's own dusk.
   */
  update(sun: THREE.Vector3, seconds: number): void {
    this.sunHere.copy(sun).normalize()
    this.sites.forEach((site, k) => {
      const night = 1 - smooth(-0.12, 0.06, site.up.dot(this.sunHere))
      this.colour.copy(GLASS).lerp(LAMP, night)
      this.lanterns.setColorAt(k, this.colour)
      this.colour.setScalar(night)
      this.beams.setColorAt(k, this.colour)
      this.spin.setFromAxisAngle(Lighthouses.Y, seconds * TURN + k * 1.7)
      this.turned.copy(site.turn).multiply(this.spin)
      this.matrix.compose(site.top, this.turned, this.size)
      this.beams.setMatrixAt(k, this.matrix)
    })
    if (this.lanterns.instanceColor !== null) this.lanterns.instanceColor.needsUpdate = true
    if (this.beams.instanceColor !== null) this.beams.instanceColor.needsUpdate = true
    this.beams.instanceMatrix.needsUpdate = true
  }
}

/** The tower: tapering, white with two red bands, a dark gallery and cap. */
function towerGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(FOOT * 0.62, FOOT, HEIGHT * 0.82, 8, 8).translate(
    0,
    HEIGHT * 0.41,
    0,
  )
  const gallery = new THREE.CylinderGeometry(FOOT * 0.85, FOOT * 0.85, HEIGHT * 0.03, 8).translate(
    0,
    HEIGHT * 0.835,
    0,
  )
  const cap = new THREE.ConeGeometry(FOOT * 0.62, HEIGHT * 0.09, 8).translate(0, HEIGHT * 1.0, 0)
  const parts: [THREE.BufferGeometry, (y: number) => readonly [number, number, number]][] = [
    [
      body,
      (y) => {
        const band = y / HEIGHT
        const red = (band > 0.22 && band < 0.38) || (band > 0.55 && band < 0.71)
        return red ? [0.62, 0.08, 0.06] : [0.92, 0.9, 0.86]
      },
    ],
    [gallery, () => [0.12, 0.12, 0.13]],
    [cap, () => [0.55, 0.07, 0.05]],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const colours: number[] = []
  for (const [geometry, paint] of parts) {
    const flat = geometry.toNonIndexed()
    const p = flat.getAttribute('position')
    const n = flat.getAttribute('normal')
    for (let k = 0; k < p.count; k += 1) {
      positions.push(p.getX(k), p.getY(k), p.getZ(k))
      normals.push(n.getX(k), n.getY(k), n.getZ(k))
      colours.push(...paint(p.getY(k)))
    }
    geometry.dispose()
    flat.dispose()
  }
  const tower = new THREE.BufferGeometry()
  tower.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  tower.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  tower.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  return tower
}

/**
 * Two beams back to back out of the lantern, each two crossed quads so it
 * reads from any side, `along` 0 at the lamp and 1 at the far end.
 */
function beamGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const along: number[] = []
  const across: number[] = []
  const index: number[] = []
  for (const way of [1, -1]) {
    for (const plane of [0, 1]) {
      const base = positions.length / 3
      for (const [t, side] of [
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 1],
      ] as const) {
        const half = (0.00005 + (SPREAD - 0.00005) * t) * side
        const x = way * REACH * t
        positions.push(x, plane === 0 ? half : 0, plane === 1 ? half : 0)
        along.push(t)
        across.push(side)
      }
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
    }
  }
  const beam = new THREE.BufferGeometry()
  beam.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  beam.setAttribute('along', new THREE.Float32BufferAttribute(along, 1))
  beam.setAttribute('across', new THREE.Float32BufferAttribute(across, 1))
  beam.setIndex(index)
  return beam
}

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float along;
      attribute float across;
      varying float vAlong;
      varying float vAcross;
      varying float vNight;
      void main() {
        vAlong = along;
        vAcross = across;
        vNight = instanceColor.r;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      varying float vAcross;
      varying float vNight;
      void main() {
        // Bright at the lamp and along its middle, thinning to nothing at its
        // reach and its edges: hard-edged, the crossed quads read as planks.
        float middle = 1.0 - vAcross * vAcross;
        float a = vNight * pow(max(0.0, 1.0 - vAlong), 2.0) * middle * middle * 0.32;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * a, 1.0);
      }
    `,
  })
}

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
