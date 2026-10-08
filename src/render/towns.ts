import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { cellOf, cellCentre } from '@/generation/hydrology'
import { surfaceAt, type Planet } from '@/generation/planet'
import { TOWN_LIGHT } from '@/generation/settlements'

import { VALLEY_FOG } from './valley-fog'
import { weather } from './weathered'

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

/**
 * A house: walls from the ground up to one, a pitched roof over with eaves
 * standing out past the walls, and a chimney on one slope, in the unit
 * square. The roof's own colour marks it for the shader, the chimney's
 * marks it as stone. A plain box with a lid read as a toy.
 */
function houseGeometry(): THREE.BufferGeometry {
  const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed()
  // The roof: a ridge along z, two slopes out past the walls to the eaves
  // (which hang a little below the wall tops), two gables at the walls.
  const r = 0.62
  const e = 0.94
  const g = 0.56
  const ridge = 1.55
  const tri = (...points: readonly (readonly [number, number, number])[]): number[] =>
    points.flatMap((p) => [...p])
  const roofPoints = [
    // Left slope, two triangles, wound to face out and up.
    ...tri([-r, e, -g], [-r, e, g], [0, ridge, g]),
    ...tri([-r, e, -g], [0, ridge, g], [0, ridge, -g]),
    // Right slope.
    ...tri([r, e, g], [r, e, -g], [0, ridge, -g]),
    ...tri([r, e, g], [0, ridge, -g], [0, ridge, g]),
    // Gables, at the wall planes.
    ...tri([-0.5, 1, 0.5], [0.5, 1, 0.5], [0, ridge, 0.5]),
    ...tri([0.5, 1, -0.5], [-0.5, 1, -0.5], [0, ridge, -0.5]),
    // The eaves' undersides, so the overhang has a thickness from below.
    ...tri([-r, e, g], [-r, e, -g], [-0.5, e, -g]),
    ...tri([-r, e, g], [-0.5, e, -g], [-0.5, e, g]),
    ...tri([r, e, -g], [r, e, g], [0.5, e, g]),
    ...tri([r, e, -g], [0.5, e, g], [0.5, e, -g]),
  ]
  const roof = new THREE.BufferGeometry()
  roof.setAttribute('position', new THREE.BufferAttribute(new Float32Array(roofPoints), 3))
  roof.computeVertexNormals()
  // The chimney: a stone stack through one slope, past the ridge line.
  const chimney = new THREE.BoxGeometry(0.13, 0.5, 0.13).translate(0.27, 1.22, -0.16).toNonIndexed()
  chimney.deleteAttribute('uv')
  const colour = (geometry: THREE.BufferGeometry, rgb: readonly [number, number, number]): void => {
    const count = geometry.getAttribute('position').count
    const colours = new Float32Array(count * 3)
    for (let k = 0; k < count; k += 1) colours.set(rgb, k * 3)
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  }
  walls.deleteAttribute('uv')
  colour(walls, [0.82, 0.78, 0.7])
  colour(roof, [0.55, 0.22, 0.16])
  colour(chimney, [0.6, 0.7, 0.2])
  const merged = new THREE.BufferGeometry()
  const parts = [walls, roof, chimney]
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
 * How a house is built where it stands, by the climate: steep slate roofs
 * over dark timber or stone where it is cold, tile or thatch over pale or
 * timbered walls in the temperate middle, flat roofs on sun-baked adobe
 * where it is hot and dry, and steep thatch over wood where it is hot and
 * wet. Each house picks among its climate's ways by its own rolls, so a
 * village is of a piece without being one house repeated.
 */
export interface HouseStyle {
  /** How steep the roof, 0 flat to about 1.6. */
  readonly pitch: number
  readonly roof: Rgb3
  readonly walls: Rgb3
}

type Rgb3 = readonly [number, number, number]
const SLATE: readonly Rgb3[] = [
  [0.22, 0.24, 0.28],
  [0.3, 0.3, 0.32],
  [0.26, 0.2, 0.18],
]
const COLD_WALLS: readonly Rgb3[] = [
  [0.36, 0.26, 0.18],
  [0.55, 0.53, 0.5],
  [0.62, 0.22, 0.16],
  [0.78, 0.74, 0.66],
]
const TILE: readonly Rgb3[] = [
  [0.6, 0.24, 0.15],
  [0.5, 0.2, 0.14],
  [0.66, 0.36, 0.2],
  [0.3, 0.3, 0.33],
]
const THATCH: readonly Rgb3[] = [
  [0.72, 0.6, 0.32],
  [0.6, 0.48, 0.28],
  [0.42, 0.36, 0.26],
]
const TEMPERATE_WALLS: readonly Rgb3[] = [
  [0.9, 0.87, 0.8],
  [0.86, 0.78, 0.6],
  [0.78, 0.7, 0.6],
  [0.62, 0.48, 0.36],
  [0.82, 0.82, 0.78],
]
const ADOBE: readonly Rgb3[] = [
  [0.82, 0.66, 0.46],
  [0.76, 0.56, 0.38],
  [0.9, 0.84, 0.72],
  [0.7, 0.5, 0.36],
]
const WOOD: readonly Rgb3[] = [
  [0.46, 0.34, 0.22],
  [0.92, 0.9, 0.84],
  [0.8, 0.56, 0.36],
  [0.66, 0.42, 0.3],
]

/**
 * The climate bands, set where towns actually stand. Settlements keep to
 * mild, wet enough ground (settlements.ts), so across five worlds their
 * warmth ran only 0.15 to 0.31 and their moisture 0.40 to 0.68, tenth to
 * ninetieth percentile; bands set by the planet's whole range (cold below
 * −0.15, hot over 0.3) put every town on every world in the temperate one.
 */
const COLDEST_TOWNS = 0.17
const WARMEST_TOWNS = 0.27
const DRIEST_TOWNS = 0.47
const WETTEST_TOWNS = 0.6

const pick = (list: readonly Rgb3[], roll: number): Rgb3 =>
  list[Math.min(list.length - 1, Math.floor(roll * list.length))] ?? [0.8, 0.8, 0.8]

export function houseStyle(
  warmth: number,
  moisture: number,
  roll: number,
  roll2: number,
): HouseStyle {
  if (warmth < COLDEST_TOWNS) {
    return { pitch: 1.2 + roll2 * 0.4, roof: pick(SLATE, roll), walls: pick(COLD_WALLS, roll2) }
  }
  if (warmth > WARMEST_TOWNS && moisture < DRIEST_TOWNS) {
    const walls = pick(ADOBE, roll)
    // Flat, the roof a shade darker than the walls; now and then a low tiled one.
    if (roll2 < 0.8) {
      return { pitch: 0.04, roof: [walls[0] * 0.85, walls[1] * 0.85, walls[2] * 0.85], walls }
    }
    return { pitch: 0.45, roof: pick(TILE, roll2), walls }
  }
  if (warmth > WARMEST_TOWNS && moisture > WETTEST_TOWNS) {
    // Thatch over timber, whitewash or red-earth plaster; a tiled roof here and there.
    const tiled = roll > 0.85
    return {
      pitch: tiled ? 0.8 : 1.3 + roll2 * 0.3,
      roof: tiled ? pick(TILE, roll2) : pick(THATCH, roll / 0.85),
      walls: pick(WOOD, roll2),
    }
  }
  const thatched = roll2 < 0.25
  return {
    pitch: thatched ? 1.25 : 0.8 + roll * 0.4,
    roof: thatched ? pick(THATCH, roll) : pick(TILE, roll),
    walls: pick(TEMPERATE_WALLS, roll2),
  }
}

const packed = (c: Rgb3): number =>
  Math.floor(Math.min(1, c[0]) * 255) * 65536 +
  Math.floor(Math.min(1, c[1]) * 255) * 256 +
  Math.floor(Math.min(1, c[2]) * 255)

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
        'uniform float townScale;\nuniform vec3 townSun;\nattribute vec4 houseStyle;\nvarying vec3 vHouseLocal;\nvarying float vHouseDark;\nvarying float vHouseSeed;\nvarying vec3 vHouseRoof;\nvarying vec3 vHouseWalls;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec4 townAt = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float townAway = distance(townAt.xyz, cameraPosition) / max(townScale, 1e-6);
          // The roof as steep as its style: from flat to a tall pitch.
          if (transformed.y > 1.001) transformed.y = 1.0 + (transformed.y - 1.0) * houseStyle.x;
          transformed.y *= 1.0 - smoothstep(${HOUSES_WHOLE.toFixed(4)}, ${HOUSES_FROM.toFixed(4)}, townAway);
          vHouseRoof = vec3(floor(houseStyle.y / 65536.0), mod(floor(houseStyle.y / 256.0), 256.0), mod(houseStyle.y, 256.0)) / 255.0;
          vHouseWalls = vec3(floor(houseStyle.z / 65536.0), mod(floor(houseStyle.z / 256.0), 256.0), mod(houseStyle.z, 256.0)) / 255.0;
          vHouseLocal = position;
          vec3 townUp = normalize(townAt.xyz);
          vHouseDark = 1.0 - smoothstep(-0.12, 0.04, dot(townUp, normalize(townSun)));
          vHouseSeed = fract(sin(dot(townAt.xyz, vec3(12.9898, 78.233, 37.719)) * 4375.85) * 43.7585);
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec3 vHouseLocal;\nvarying float vHouseDark;\nvarying float vHouseSeed;\nvarying vec3 vHouseRoof;\nvarying vec3 vHouseWalls;\nfloat vHouseGlass = 0.0;\nvoid main() {',
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          // The model's own colours only say which is roof, which wall and
          // which chimney.
          float roof = step(diffuseColor.g, 0.5);
          float chimney = step(0.5, diffuseColor.g) * step(diffuseColor.b, 0.3);
          vec3 walls = vHouseWalls;
          // Weathered: darker at the foot where the rain splashes, and each
          // face a touch different from the next.
          walls *= mix(0.72, 1.0, smoothstep(0.0, 0.35, vHouseLocal.y));
          walls *= 0.92 + 0.16 * fract(sin(dot(floor(vHouseLocal * 2.0 + 0.5), vec3(17.1, 31.7, 11.3)) + vHouseSeed * 40.0) * 4375.85);
          // Windows and a door by day as well as by night: a wall with
          // nothing on it read as a crate. The panes are dark glass in a
          // pale frame, two rows along each face; the door on the front.
          float along = abs(vHouseLocal.x) > 0.499 ? vHouseLocal.z : vHouseLocal.x;
          float px = fract(along * 3.0 + 0.5);
          float py = fract(vHouseLocal.y * 2.0);
          float frame = step(0.26, px) * step(px, 0.74) * step(0.16, py) * step(py, 0.59);
          float glass = step(0.3, px) * step(px, 0.7) * step(0.2, py) * step(py, 0.55);
          float onWall = step(vHouseLocal.y, 0.95) * (1.0 - roof) * (1.0 - chimney);
          float door = step(abs(vHouseLocal.x), 0.13) * step(vHouseLocal.y, 0.46) * step(0.499, vHouseLocal.z);
          vHouseGlass = glass * onWall * (1.0 - door);
          walls = mix(walls, walls * 1.12 + 0.05, frame * onWall * (1.0 - door));
          walls = mix(walls, vec3(0.1, 0.13, 0.17), vHouseGlass);
          walls = mix(walls, vec3(0.28, 0.17, 0.1), door * onWall);
          // The roof in courses: tiles or slates in rows up the slope.
          vec3 roofColour = vHouseRoof * (0.9 + 0.2 * fract(vHouseSeed * 13.0));
          float course = 0.92 + 0.08 * step(0.5, fract((vHouseLocal.y - 1.0) * 14.0 + step(0.5, fract(vHouseLocal.z * 7.0)) * 0.5));
          roofColour *= course;
          vec3 stone = vec3(0.42, 0.4, 0.38) * (0.9 + 0.2 * fract(vHouseSeed * 7.0));
          diffuseColor.rgb = mix(mix(walls, roofColour, roof), stone, chimney);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // A little light of their own colour by day, as the herds have:
        // a wall in shade is still a white wall, not a dark slab.
        totalEmissiveRadiance += diffuseColor.rgb * 0.22 * (1.0 - vHouseDark);
        // Windows: on the walls only (below the eaves), in two rows of
        // panes along each face, on most houses after dark.
        if (vHouseDark > 0.01) {
          float lit = step(0.25, vHouseSeed);
          totalEmissiveRadiance += vec3(1.0, 0.7, 0.35) * vHouseGlass * lit * vHouseDark * 1.6;
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // The sky's light in the shade, less its blue, as for the trees:
        // a whitewashed wall in shade is grey, not sky-coloured.
        reflectedLight.indirectDiffuse = mix(
          reflectedLight.indirectDiffuse,
          vec3(dot(reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114))),
          0.65
        ) * mix(1.4, 1.0, vHouseDark);`,
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

  constructor(sites: TownSites, planet: Planet) {
    const model = houseGeometry()
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
    growNear(material, this.scale)
    // No wall laid true nor plastered even (weathered.ts); its own light and
    // the shade's colour are seen to by growNear.
    weather(material, { rough: 0.03, mottle: 0.12, grain: 14000, own: 0 })
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
    const Y = new THREE.Vector3(0, 1, 0)
    const towards = new THREE.Vector3()
    const side = new THREE.Vector3()
    const basis = new THREE.Matrix4()
    for (const [cell, houses] of byCell) {
      // Each cell its own handle on the model, to carry its houses' styles.
      const geometry = new THREE.BufferGeometry()
      for (const [name, attribute] of Object.entries(model.attributes)) {
        geometry.setAttribute(name, attribute)
      }
      const styles = new Float32Array(houses.length * 4)
      const mesh = new THREE.InstancedMesh(geometry, material, houses.length)
      // The heart of the town here: houses face it, so they ring it in
      // streets rather than each turned its own way.
      const heart = new THREE.Vector3()
      for (const house of houses) heart.add(towards.set(...house.at))
      heart.normalize()
      // The brightest house of the cell is its tower: a church, a temple, a hall.
      let tower = 0
      houses.forEach((house, k) => {
        if (house.bright > (houses[tower]?.bright ?? 0)) tower = k
      })
      houses.forEach((house, k) => {
        const h = Math.sin((house.at[0] * 7919 + house.at[2] * 104729) * 1e3) * 43758.5453
        const roll = h - Math.floor(h)
        const h2 = Math.sin((house.at[1] * 6271 + house.at[0] * 92821) * 1e3) * 43758.5453
        const roll2 = h2 - Math.floor(h2)
        up.set(...house.at).normalize()
        // Facing the heart, give or take a little — or square to it.
        towards.copy(heart).addScaledVector(up, -heart.dot(up))
        if (towards.lengthSq() < 1e-12) towards.set(1, 0, 0).cross(up)
        towards.normalize()
        side.crossVectors(up, towards).normalize()
        basis.makeBasis(side, up, towards)
        turn.setFromRotationMatrix(basis)
        spin.setFromAxisAngle(Y, (roll2 < 0.3 ? Math.PI / 2 : 0) + (roll - 0.5) * 0.35)
        // Bigger towards the heart of a town, where its lights are brightest.
        const grand = 0.7 + house.bright * 0.6
        const isTower = k === tower && houses.length > 4
        if (isTower) {
          size.set(0.00026 * grand, 0.0006 * grand, 0.00026 * grand)
        } else {
          // Cottages, long houses and the odd second storey.
          const long = roll2 > 0.7 ? 1.6 : 1
          const storeys = roll > 0.82 && house.bright > 0.7 ? 1.7 : 1
          size.set(
            0.00034 * grand * (0.85 + roll * 0.3),
            (0.00026 + roll * 0.00008) * grand * storeys,
            0.0003 * grand * long,
          )
        }
        // Sunk a little, so a house on a slope does not stand on a corner.
        place.set(...house.at).addScaledVector(up, -0.00008)
        matrix.compose(place, turn.multiply(spin), size)
        mesh.setMatrixAt(k, matrix)
        const surface = surfaceAt(planet, up.x, up.y, up.z)
        const style = houseStyle(surface.warmth, surface.moisture, roll, roll2)
        styles.set(
          [
            isTower ? Math.max(style.pitch, 1.6) : style.pitch,
            packed(style.roof),
            packed(style.walls),
            0,
          ],
          k * 4,
        )
      })
      geometry.setAttribute('houseStyle', new THREE.InstancedBufferAttribute(styles, 4))
      mesh.instanceMatrix.needsUpdate = true
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
