import * as THREE from 'three'

import { unkey } from '@/generation/growth'
import type { Planet } from '@/generation/planet'
import { AREA, BASE_ROW, BLOCK, type Block, type Frame } from '@/generation/voxel'

import { fromPalette } from './colour'
import { DETAIL_CLOUD_SUN } from './detail'

/**
 * The marks a surveyor leaves, seen from the air: every block placed on a
 * plot as a cube, every block dug as a dark one, lamps as points of light
 * on the night side. Drawn from the saved edits of each plot, placed in
 * the same frame the landing's blocks are cut in, so a wall built on the
 * ground is the wall flown over.
 *
 * Cheap on purpose: one instanced mesh per plot of unit cubes, which is
 * sub-pixel from orbit and a stand of blocks from a low glide. A plot being
 * walked on is hidden, because its blocks are on screen for real.
 */

/** A plot's marks: its frame and its edits, as the save holds them. */
export interface PlotMarks {
  readonly name: string
  readonly frame: Frame
  readonly base: number
  readonly edits: readonly (readonly [number, Block] | readonly [number, Block, number])[]
}

const DUG = new THREE.Color(0.06, 0.05, 0.05)

/** The colour a placed block shows from the air, by kind. */
function tintOf(block: Block, planet: Planet): THREE.Color {
  switch (block) {
    case 'grass':
    case 'leaves':
    case 'needles':
    case 'cactus':
    case 'sapling':
      return fromPalette(planet.palette.lush)
    case 'earth':
    case 'wood':
      return new THREE.Color(0.35, 0.24, 0.14)
    case 'stone':
    case 'gravel':
      return fromPalette(planet.palette.highland)
    case 'sand':
      return fromPalette(planet.palette.dry)
    case 'snow':
    case 'ice':
      return fromPalette(planet.palette.ice)
    case 'basalt':
      return new THREE.Color(0.2, 0.19, 0.18)
    case 'lamp':
      return new THREE.Color(1, 0.85, 0.5)
    case 'cache':
      return new THREE.Color(0.95, 0.72, 0.2)
    case 'air':
    case 'water':
    case 'lava':
      return DUG
  }
}

const CUBE = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)

/** Lamps as points: lit on the night side, barely there in daylight. */
function lampMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { sun: DETAIL_CLOUD_SUN },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 sun;
      varying float vNight;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        // The planet's frame is the terrain group's: its normal here is the
        // position's own direction, since marks sit on the surface.
        vec3 outward = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vNight = smoothstep(0.15, -0.15, dot(outward, sun));
        gl_Position = projectionMatrix * viewMatrix * world;
        gl_PointSize = 5.0;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vNight;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float glow = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * glow, glow * (0.15 + 0.85 * vNight));
      }
    `,
  })
}

/** Place a group the way the landing's blocks are placed: the plot frame, scaled to blocks. */
export function placeInPlot(group: THREE.Object3D, frame: Frame, base: number): void {
  const [ox, oy, oz] = frame.origin
  const [ex, ey, ez] = frame.east
  const [nx, ny, nz] = frame.north
  const basis = new THREE.Matrix4().set(ex, ox, nx, 0, ey, oy, ny, 0, ez, oz, nz, 0, 0, 0, 0, 1)
  group.quaternion.setFromRotationMatrix(basis)
  group.scale.setScalar(BLOCK)
  const shift = new THREE.Vector3(-AREA / 2, -BASE_ROW, -AREA / 2).multiplyScalar(BLOCK)
  shift.applyQuaternion(group.quaternion)
  group.position.set(ox * base, oy * base, oz * base).add(shift)
}

/** The marks of one plot as a group, or nothing when the plot holds no edit. */
export function buildPlotMarks(plot: PlotMarks, planet: Planet): THREE.Group | undefined {
  if (plot.edits.length === 0) return undefined
  const group = new THREE.Group()
  group.name = plot.name
  placeInPlot(group, plot.frame, plot.base)
  const cubes = new THREE.InstancedMesh(
    CUBE,
    new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
    plot.edits.length,
  )
  const at = new THREE.Matrix4()
  const lamps: number[] = []
  let count = 0
  for (const [key, block] of plot.edits) {
    const [x, y, z] = unkey(key)
    at.makeTranslation(x, y, z)
    cubes.setMatrixAt(count, at)
    cubes.setColorAt(count, tintOf(block, planet))
    count += 1
    if (block === 'lamp') lamps.push(x + 0.5, y + 0.8, z + 0.5)
  }
  cubes.count = count
  cubes.instanceMatrix.needsUpdate = true
  if (cubes.instanceColor !== null) cubes.instanceColor.needsUpdate = true
  cubes.castShadow = true
  group.add(cubes)
  if (lamps.length > 0) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3))
    group.add(new THREE.Points(geometry, lampMaterial()))
  }
  return group
}

export function releaseMarks(group: THREE.Object3D): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) return
    const geometry: unknown = child.geometry
    if (geometry instanceof THREE.BufferGeometry && geometry !== CUBE) geometry.dispose()
    const material: unknown = child.material
    if (material instanceof THREE.Material) material.dispose()
    if (child instanceof THREE.InstancedMesh) child.dispose()
  })
}
