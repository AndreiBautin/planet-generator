import { faceUvOf, type Vec3 } from './cube'
import { floorRadiusAt, SEA_RADIUS } from './ground'
import { CELL, featureWord, placementsIn, type Placement } from './placement'
import { surfaceAt, type Planet, type Surface } from './planet'

/**
 * A landing: the ground under a point on the planet, as blocks.
 *
 * The planet stays what it is for orbit and flight. Land, and the area
 * around the landing point is cut into metre-ish blocks from the same
 * height, biome and features the flyover drew — grass over earth over
 * stone, sand on the beaches, snow on the heights, basalt and lava on a
 * molten world, water below sea level, and block trees and stone where
 * the flyover had trees and rock. The same hashes decide where, so the
 * tree you saw from the air is the tree you walk up to.
 *
 * Laid in a tangent frame at the landing point: `x` runs east, `z` north,
 * `y` up, and the curvature over the area is a block or two, ignored. A
 * block is `BLOCK` radii; a tree stands five or six of them.
 *
 * Pure and deterministic: the same seed and landing point cut the same
 * blocks on every device. Edits are a diff kept elsewhere, laid over this.
 */
export const BLOCK = 0.0002
/** Blocks across a landing area, each way. */
export const AREA = 256
/** Blocks a column stands tall. */
export const HEIGHT = 192
/** The row the sea's surface sits at. */
export const SEA_LEVEL = 64

export const BLOCKS = [
  'air',
  'water',
  'lava',
  'grass',
  'earth',
  'stone',
  'sand',
  'snow',
  'ice',
  'basalt',
  'gravel',
  'wood',
  'leaves',
  'needles',
  'cactus',
] as const
export type Block = (typeof BLOCKS)[number]

/** The tangent frame of a landing: where it is and which way is east and north. */
export interface Frame {
  /** The landing point, a unit direction. */
  readonly origin: Vec3
  readonly east: Vec3
  readonly north: Vec3
}

export interface Landing extends Frame {
  readonly planet: Planet
  /** Blocks the features stamp into the air above the ground: trunks, crowns, stone. */
  readonly stamps: ReadonlyMap<number, Block>
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** One number for a block position, for the stamp map. */
export const blockKey = (x: number, y: number, z: number): number =>
  ((x + 1024) * 2048 + (z + 1024)) * 256 + y

/** The unit direction of a block column's centre, from the landing frame. */
export function directionOf(landing: Frame, x: number, z: number): Vec3 {
  const ex = (x - AREA / 2 + 0.5) * BLOCK
  const nz = (z - AREA / 2 + 0.5) * BLOCK
  return unit([
    landing.origin[0] + landing.east[0] * ex + landing.north[0] * nz,
    landing.origin[1] + landing.east[1] * ex + landing.north[1] * nz,
    landing.origin[2] + landing.east[2] * ex + landing.north[2] * nz,
  ])
}

/** The block column a direction falls in: the inverse of `directionOf`, unrounded. */
export function columnOf(landing: Frame, direction: Vec3): readonly [number, number] {
  const along = dot(direction, landing.origin) || 1e-9
  return [
    dot(direction, landing.east) / along / BLOCK + AREA / 2 - 0.5,
    dot(direction, landing.north) / along / BLOCK + AREA / 2 - 0.5,
  ]
}

/** The row the ground's top block sits on, from the radius of the drawn ground. */
export function groundRowOf(radius: number): number {
  return Math.max(1, Math.min(HEIGHT - 2, SEA_LEVEL + Math.round((radius - SEA_RADIUS) / BLOCK)))
}

export interface Column {
  readonly surface: Surface
  /** Row of the top solid block. */
  readonly ground: number
  /** What the top block is, what lies under it and how deep, and what is below that. */
  readonly top: Block
  readonly under: Block
  readonly depth: number
  readonly deep: Block
}

/** What a column of ground is made of, from its surface. */
function layersOf(
  planet: Planet,
  surface: Surface,
): Pick<Column, 'top' | 'under' | 'depth' | 'deep'> {
  if (planet.molten) return { top: 'basalt', under: 'basalt', depth: 3, deep: 'stone' }
  if (surface.height < 0) return { top: 'sand', under: 'gravel', depth: 2, deep: 'stone' }
  switch (surface.biome) {
    case 'shore':
      return { top: 'sand', under: 'sand', depth: 4, deep: 'stone' }
    case 'snow':
    case 'sea-ice':
      return { top: 'snow', under: 'snow', depth: 2, deep: 'stone' }
    case 'highland':
      return surface.height > 0.6
        ? { top: 'stone', under: 'stone', depth: 1, deep: 'stone' }
        : { top: 'gravel', under: 'earth', depth: 2, deep: 'stone' }
    case 'land':
    case 'shallow':
    case 'deep':
      if (planet.kind === 'arid') return { top: 'sand', under: 'sand', depth: 3, deep: 'stone' }
      return { top: 'grass', under: 'earth', depth: 3, deep: 'stone' }
  }
}

export function columnAt(landing: Landing, x: number, z: number): Column {
  const direction = directionOf(landing, x, z)
  const surface = surfaceAt(landing.planet, direction[0], direction[1], direction[2])
  const ground = groundRowOf(floorRadiusAt(landing.planet, direction))
  return { surface, ground, ...layersOf(landing.planet, surface) }
}

/** The block at a row of a column. */
export function blockAt(landing: Landing, x: number, z: number, column: Column, y: number): Block {
  if (y < 0 || y >= HEIGHT) return 'air'
  if (y <= column.ground) {
    if (y === column.ground) return column.top
    if (y > column.ground - 1 - column.depth) return column.under
    return column.deep
  }
  const stamped = landing.stamps.get(blockKey(x, y, z))
  if (stamped !== undefined) return stamped
  if (y <= SEA_LEVEL) {
    if (landing.planet.molten) return 'lava'
    if (column.surface.biome === 'sea-ice' && y === SEA_LEVEL) return 'ice'
    return 'water'
  }
  return 'air'
}

/**
 * Stamp a feature into the block map: a trunk and a crown, a stone, a
 * column, a floe. Sizes follow the size roll the scatterer uses, so a big
 * tree from the air is a big tree on the ground.
 */
function stamp(
  stamps: Map<number, Block>,
  placed: Placement,
  x: number,
  z: number,
  ground: number,
): void {
  const roll = placed.rolls[0]
  const put = (dx: number, dy: number, dz: number, block: Block): void => {
    stamps.set(blockKey(x + dx, ground + dy, z + dz), block)
  }
  const blob = (cy: number, radius: number, block: Block): void => {
    const r = Math.ceil(radius)
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dz = -r; dz <= r; dz += 1) {
          if (dx * dx + dy * dy * 1.4 + dz * dz <= radius * radius) put(dx, cy + dy, dz, block)
        }
      }
    }
  }
  switch (placed.feature) {
    case 'broadleaf': {
      const trunk = 3 + Math.round(roll * 3)
      blob(trunk + 1, 2 + roll * 1.5, 'leaves')
      for (let dy = 1; dy <= trunk + 1; dy += 1) put(0, dy, 0, 'wood')
      return
    }
    case 'conifer': {
      const trunk = 4 + Math.round(roll * 4)
      for (let dy = 1; dy <= trunk; dy += 1) {
        // A cone: wider at the bottom of the crown, a point at the top.
        const width = Math.max(0, Math.round((trunk - dy) * 0.45))
        if (dy >= 2) {
          for (let dx = -width; dx <= width; dx += 1) {
            for (let dz = -width; dz <= width; dz += 1) {
              if (Math.abs(dx) + Math.abs(dz) <= width) put(dx, dy, dz, 'needles')
            }
          }
        }
        put(0, dy, 0, 'wood')
      }
      put(0, trunk + 1, 0, 'needles')
      return
    }
    case 'shrub':
      blob(1, 1 + roll * 0.6, 'leaves')
      return
    case 'cactus': {
      const tall = 2 + Math.round(roll * 2)
      for (let dy = 1; dy <= tall; dy += 1) put(0, dy, 0, 'cactus')
      return
    }
    case 'rock':
      put(0, 1, 0, 'stone')
      if (roll > 0.5) put(1, 1, 0, 'stone')
      return
    case 'boulder':
      blob(1, 1.2 + roll, 'stone')
      return
    case 'spire': {
      const tall = 3 + Math.round(roll * 4)
      const block: Block = placed.surface.biome === 'snow' ? 'ice' : 'basalt'
      for (let dy = 1; dy <= tall; dy += 1) put(0, dy, 0, block)
      return
    }
    case 'floe': {
      const r = 1 + Math.round(roll * 2)
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dz = -r; dz <= r; dz += 1) {
          if (dx * dx + dz * dz <= r * r) stamps.set(blockKey(x + dx, SEA_LEVEL, z + dz), 'ice')
        }
      }
      return
    }
    case 'grass':
    case 'cone':
      return
  }
}

/**
 * The landing at a point: its frame, and every feature in reach stamped
 * into blocks. Features are read off the cube face the landing point falls
 * on; an area straddling a cube edge misses the strip over the edge, which
 * is twelve edges on a planet and is accepted.
 */
/** The frame of a landing at a point: east is along the planet's turn, north towards its pole. */
export function frameAt(direction: Vec3): Frame {
  const origin = unit(direction)
  const polar = Math.abs(origin[1]) > 0.999
  const east = unit(cross(polar ? [0, 0, 1] : [0, 1, 0], origin))
  const north = cross(origin, east)
  return { origin, east, north }
}

export function landingAt(planet: Planet, direction: Vec3): Landing {
  const { origin, east, north } = frameAt(direction)
  const stamps = new Map<number, Block>()
  const landing: Landing = { planet, origin, east, north, stamps }

  const { face, u, v } = faceUvOf(origin)
  // Cells reaching a little past the area, so a crown rooted just outside
  // still hangs in.
  const reach = Math.ceil(((AREA / 2 + 4) * BLOCK) / (CELL * 0.75))
  const word = featureWord(planet)
  const i0 = Math.floor(u / CELL)
  const j0 = Math.floor(v / CELL)
  for (let j = j0 - reach; j <= j0 + reach; j += 1) {
    for (let i = i0 - reach; i <= i0 + reach; i += 1) {
      for (const placed of placementsIn(planet, face, i, j, word)) {
        if (!placed.standing) continue
        const [cx, cz] = columnOf(landing, placed.direction)
        const x = Math.round(cx)
        const z = Math.round(cz)
        if (x < -4 || z < -4 || x >= AREA + 4 || z >= AREA + 4) continue
        const ground =
          placed.feature === 'floe'
            ? SEA_LEVEL
            : groundRowOf(floorRadiusAt(planet, directionOf(landing, x, z)))
        stamp(stamps, placed, x, z, ground)
      }
    }
  }
  return landing
}
