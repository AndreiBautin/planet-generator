import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { cellOf, cellCentre } from '@/generation/hydrology'
import { TOWN_LIGHT } from '@/generation/settlements'

import { VALLEY_FOG } from './valley-fog'

/**
 * Towns you can see: the lit world's buildings and roads, close to.
 *
 * They are made from the lights (generation/settlements.ts), already
 * placed on the drawn ground in the build worker: each light of a town is
 * a house, and the fainter lights strung between towns are a road. So a
 * house stands wherever a window will be lit at night, and the two never
 * disagree.
 *
 * Houses are boxes with pitched roofs, a few triangles each, instanced and
 * kept in one mesh per cell of the drainage map, so only the cells near
 * the eye are drawn at all. They grow up out of the ground as the eye
 * comes near rather than appearing (`HOUSES_FROM`), and the roads fade the
 * same way.
 */

/** Lights at least this bright are a town's (0.45 up, settlements.ts); roads are 0.42 at most. Below 0.45 itself, since a light stored as a float32 can come back a hair under it. */
export { TOWN_LIGHT } from '@/generation/settlements'
/** How near, in radii, houses start to grow up, and how near they are whole. */
const HOUSES_FROM = 0.05
const HOUSES_WHOLE = 0.032
/** Two road lights further apart than this, in radians, are not one road. */
const ROAD_GAP = 0.0045
/** The lights are placed this far over the ground; buildings stand on it. */
const LIGHT_LIFT = 0.0002

export interface TownSites {
  /** Where each house stands, on the ground, with its light's brightness and warmth. */
  readonly houses: readonly { readonly at: Vec3; readonly bright: number; readonly warm: number }[]
  /** Each road as the points it runs through, in order. */
  readonly roads: readonly (readonly Vec3[])[]
}

/** Houses and roads from the placed lights, five numbers each (work.ts, `placedLights`). */
export function townSites(placed: Float32Array): TownSites {
  const houses: { at: Vec3; bright: number; warm: number }[] = []
  const roads: Vec3[][] = []
  let road: Vec3[] = []
  for (let k = 0; k + 4 < placed.length; k += 5) {
    const x = placed[k] ?? 0
    const y = placed[k + 1] ?? 0
    const z = placed[k + 2] ?? 1
    const length = Math.hypot(x, y, z) || 1
    const ground = length - LIGHT_LIFT
    const at: Vec3 = [(x / length) * ground, (y / length) * ground, (z / length) * ground]
    const bright = placed[k + 3] ?? 0
    if (bright >= TOWN_LIGHT) {
      houses.push({ at, bright, warm: placed[k + 4] ?? 0.5 })
      continue
    }
    const last = road.at(-1)
    if (last !== undefined) {
      const ll = Math.hypot(...last) || 1
      const apart = Math.acos(
        Math.min(1, (last[0] * x + last[1] * y + last[2] * z) / (ll * length)),
      )
      if (apart > ROAD_GAP) {
        if (road.length > 1) roads.push(road)
        road = []
      }
    }
    road.push(at)
  }
  if (road.length > 1) roads.push(road)
  return { houses, roads }
}

/** A house: walls from the ground up to one, a pitched roof over, in the unit square. */
function houseGeometry(): THREE.BufferGeometry {
  const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed()
  // The roof: a ridge along z, two slopes and two gables.
  const roof = new THREE.BufferGeometry()
  const r = 0.55
  roof.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        // Slopes.
        -r,
        1,
        -r,
        -r,
        1,
        r,
        0,
        1.55,
        r,
        -r,
        1,
        -r,
        0,
        1.55,
        r,
        0,
        1.55,
        -r,
        r,
        1,
        r,
        r,
        1,
        -r,
        0,
        1.55,
        -r,
        r,
        1,
        r,
        0,
        1.55,
        -r,
        0,
        1.55,
        r,
        // Gables.
        -r,
        1,
        r,
        r,
        1,
        r,
        0,
        1.55,
        r,
        r,
        1,
        -r,
        -r,
        1,
        -r,
        0,
        1.55,
        -r,
      ]),
      3,
    ),
  )
  roof.computeVertexNormals()
  const colour = (geometry: THREE.BufferGeometry, rgb: readonly [number, number, number]): void => {
    const count = geometry.getAttribute('position').count
    const colours = new Float32Array(count * 3)
    for (let k = 0; k < count; k += 1) colours.set(rgb, k * 3)
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  }
  walls.deleteAttribute('uv')
  colour(walls, [0.82, 0.78, 0.7])
  colour(roof, [0.55, 0.22, 0.16])
  const merged = new THREE.BufferGeometry()
  const parts = [walls, roof]
  const total = parts.reduce((n, g) => n + g.getAttribute('position').count, 0)
  for (const name of ['position', 'normal', 'color']) {
    const out = new Float32Array(total * 3)
    let at = 0
    for (const part of parts) {
      const source = part.getAttribute(name).array
      out.set(source, at)
      at += source.length
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3))
  }
  return merged
}

/**
 * Grow a material's instances up out of the ground as the eye comes near,
 * and light their windows at night: two rows of small panes along each
 * wall, some houses lit and some dark, warm against the dusk.
 */
function growNear(material: THREE.MeshStandardMaterial, scale: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.townScale = scale
    shader.uniforms.townSun = VALLEY_FOG.sun
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'uniform float townScale;\nuniform vec3 townSun;\nvarying vec3 vHouseLocal;\nvarying float vHouseDark;\nvarying float vHouseSeed;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec4 townAt = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float townAway = distance(townAt.xyz, cameraPosition) / max(townScale, 1e-6);
          transformed.y *= 1.0 - smoothstep(${HOUSES_WHOLE.toFixed(4)}, ${HOUSES_FROM.toFixed(4)}, townAway);
          vHouseLocal = position;
          vec3 townUp = normalize(townAt.xyz);
          vHouseDark = 1.0 - smoothstep(-0.12, 0.04, dot(townUp, normalize(townSun)));
          vHouseSeed = fract(sin(dot(townAt.xyz, vec3(12.9898, 78.233, 37.719)) * 4375.85) * 43.7585);
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec3 vHouseLocal;\nvarying float vHouseDark;\nvarying float vHouseSeed;\nvoid main() {',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Windows: on the walls only (below the eaves), in two rows of
        // panes along each face, on most houses after dark.
        if (vHouseDark > 0.01 && vHouseLocal.y < 0.95) {
          float along = abs(vHouseLocal.x) > 0.499 ? vHouseLocal.z : vHouseLocal.x;
          float pane = step(0.3, fract(along * 3.0 + 0.5)) * step(fract(along * 3.0 + 0.5), 0.7);
          float row = step(0.2, fract(vHouseLocal.y * 2.0)) * step(fract(vHouseLocal.y * 2.0), 0.55);
          float lit = step(0.25, vHouseSeed);
          totalEmissiveRadiance += vec3(1.0, 0.7, 0.35) * pane * row * lit * vHouseDark * 1.6;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'planet-houses'
}

/**
 * The buildings and roads of one lit world, as a group to hang on its
 * ground (a child of the terrain, so it turns and scales with it).
 * `update` shows only the cells near the eye.
 */
export class Towns {
  readonly group = new THREE.Group()
  private readonly cells: { readonly mesh: THREE.InstancedMesh; readonly centre: Vec3 }[] = []
  private readonly scale = { value: 1 }
  private readonly roadFade = { value: 1 }

  constructor(sites: TownSites) {
    const geometry = houseGeometry()
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
    growNear(material, this.scale)
    // Houses by cell, so only the near ones are drawn.
    const byCell = new Map<number, (typeof sites.houses)[number][]>()
    for (const house of sites.houses) {
      const cell = cellOf(house.at)
      const list = byCell.get(cell) ?? []
      list.push(house)
      byCell.set(cell, list)
    }
    const matrix = new THREE.Matrix4()
    const up = new THREE.Vector3()
    const turn = new THREE.Quaternion()
    const spin = new THREE.Quaternion()
    const size = new THREE.Vector3()
    const place = new THREE.Vector3()
    const tint = new THREE.Color()
    const Y = new THREE.Vector3(0, 1, 0)
    for (const [cell, houses] of byCell) {
      const mesh = new THREE.InstancedMesh(geometry, material, houses.length)
      houses.forEach((house, k) => {
        const h = Math.sin((house.at[0] * 7919 + house.at[2] * 104729) * 1e3) * 43758.5453
        const roll = h - Math.floor(h)
        up.set(...house.at).normalize()
        turn.setFromUnitVectors(Y, up)
        spin.setFromAxisAngle(Y, roll * Math.PI * 2)
        // Bigger towards the heart of a town, where its lights are brightest.
        const grand = 0.7 + house.bright * 0.6
        size.set(
          0.0004 * grand,
          (0.00028 + roll * 0.0003) * grand,
          (0.0003 + roll * 0.0002) * grand,
        )
        // Sunk a little, so a house on a slope does not stand on a corner.
        place.set(...house.at).addScaledVector(up, -0.00008)
        matrix.compose(place, turn.multiply(spin), size)
        mesh.setMatrixAt(k, matrix)
        // Walls from white to ochre; a few cold-lit ones grey.
        tint.setRGB(1, 0.94 + roll * 0.06, 0.86 + house.warm * 0.1)
        mesh.setColorAt(k, tint)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.visible = false
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.cells.push({ mesh, centre: cellCentre(cell) })
    }
    const roads = roadMesh(sites.roads, this.roadFade, this.scale)
    if (roads !== undefined) this.group.add(roads)
  }

  /** Show the cells near `eye` (the planet's frame, in radii); `scale` the planet's size. */
  update(eye: Vec3, scale: number): void {
    this.scale.value = scale
    const length = Math.hypot(eye[0], eye[1], eye[2]) || 1
    const near = Math.cos(0.06)
    for (const { mesh, centre } of this.cells) {
      const facing = (eye[0] * centre[0] + eye[1] * centre[1] + eye[2] * centre[2]) / length
      mesh.visible = facing > near && length - 1 < HOUSES_FROM
    }
  }
}

/** The roads: a narrow strip laid along each, faded out with distance as the houses are. */
function roadMesh(
  roads: readonly (readonly Vec3[])[],
  fade: { value: number },
  scale: { value: number },
): THREE.Mesh | undefined {
  const positions: number[] = []
  const half = 0.00012
  for (const road of roads) {
    for (let k = 0; k + 1 < road.length; k += 1) {
      const a = road[k]
      const b = road[k + 1]
      if (a === undefined || b === undefined) continue
      const up = normal([a[0] + b[0], a[1] + b[1], a[2] + b[2]])
      const along = normal([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
      const side = normal([
        up[1] * along[2] - up[2] * along[1],
        up[2] * along[0] - up[0] * along[2],
        up[0] * along[1] - up[1] * along[0],
      ])
      const lift = 0.00005
      const corner = (p: Vec3, s: number): number[] => [
        p[0] + side[0] * half * s + up[0] * lift,
        p[1] + side[1] * half * s + up[1] * lift,
        p[2] + side[2] * half * s + up[2] * lift,
      ]
      positions.push(...corner(a, -1), ...corner(b, -1), ...corner(b, 1))
      positions.push(...corner(a, -1), ...corner(b, 1), ...corner(a, 1))
    }
  }
  if (positions.length === 0) return undefined
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.32, 0.29, 0.25),
    roughness: 0.95,
    side: THREE.DoubleSide,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.roadFade = fade
    shader.uniforms.townScale = scale
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float townScale;\nvarying float vRoadAway;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vRoadAway = distance((modelMatrix * vec4(transformed, 1.0)).xyz, cameraPosition) / max(townScale, 1e-6);',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vRoadAway;\nvoid main() {')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\n  gl_FragColor.a *= 1.0 - smoothstep(${HOUSES_WHOLE.toFixed(4)}, ${HOUSES_FROM.toFixed(4)}, vRoadAway);`,
      )
  }
  material.customProgramCacheKey = () => 'planet-roads'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1
  return mesh
}

const normal = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
