import type { Rgb } from './kinds'
import { blockAt, BLOCKS, columnAt, HEIGHT, type Block, type Landing } from './voxel'

/**
 * A chunk of a landing — 16 × 16 columns, the full height — as blocks, and
 * as a mesh of only the faces that can be seen: every face between a solid
 * block and air or water, nothing between two solids. A column of stone
 * two hundred deep costs the one face on top.
 *
 * The blocks are kept with a one-block halo from the neighbouring columns
 * so the faces along a chunk's edge are decided here, without the chunk
 * next door, which may not exist yet.
 *
 * The mesh carries, per vertex: its position in the chunk, its normal, a
 * tint (the biome's colour for that kind of block, darkened in corners —
 * ambient occlusion baked once), which of the ground photographs to wear,
 * and where on it. Fluid — water, or lava on a molten world — is a second
 * mesh of its own, drawn transparent.
 *
 * Pure: typed arrays in and out, so it runs in a worker and crosses back
 * without a copy.
 */
export const CHUNK = 16
const HALO = CHUNK + 2

export const SOLID: ReadonlySet<Block> = new Set<Block>(
  BLOCKS.filter((block) => block !== 'air' && block !== 'water' && block !== 'lava'),
)
export const FLUID: ReadonlySet<Block> = new Set<Block>(['water', 'lava'])

export const blockId = (block: Block): number => BLOCKS.indexOf(block)
export const blockOf = (id: number): Block => BLOCKS[id] ?? 'air'

/** The index into a chunk's block array, with x and z from −1 to CHUNK. */
export const at = (x: number, y: number, z: number): number =>
  ((x + 1) * HALO + (z + 1)) * HEIGHT + y

/** The blocks of a chunk and its halo, from the landing, with any edits laid over. */
export function chunkBlocks(
  landing: Landing,
  cx: number,
  cz: number,
  edits: ReadonlyMap<number, Block> = new Map(),
  editKey: (x: number, y: number, z: number) => number = () => -1,
): Uint8Array {
  const blocks = new Uint8Array(HALO * HALO * HEIGHT)
  for (let x = -1; x <= CHUNK; x += 1) {
    for (let z = -1; z <= CHUNK; z += 1) {
      const wx = cx * CHUNK + x
      const wz = cz * CHUNK + z
      const column = columnAt(landing, wx, wz)
      for (let y = 0; y < HEIGHT; y += 1) {
        const edited = edits.size > 0 ? edits.get(editKey(wx, y, wz)) : undefined
        blocks[at(x, y, z)] = blockId(edited ?? blockAt(landing, wx, wz, column, y))
      }
    }
  }
  return blocks
}

/** Which photograph a face wears: the ground kinds, in the order textures.ts lists them. */
export type Tile = 0 | 1 | 2 | 3 | 4 | 5 | 6
const GRASS: Tile = 0
const LITTER: Tile = 1
const SAND: Tile = 2
const STONE: Tile = 3
const SNOW: Tile = 4
const BASALT: Tile = 5
/** Not a photograph: a lamp's own light, which the chunk material glows with. */
const LAMP: Tile = 6

export interface Palette {
  readonly lush: Rgb
  readonly dry: Rgb
  readonly highland: Rgb
  readonly peak: Rgb
  readonly ice: Rgb
  readonly shallow: Rgb
}

interface Look {
  readonly tile: Tile
  readonly tint: Rgb
}

/** What each block looks like, from a planet's own colours: top, sides, bottom. */
function looksOf(palette: Palette): Readonly<Record<Block, readonly [Look, Look, Look]>> {
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
  const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]
  const earth: Rgb = scale(mix(palette.highland, [0.3, 0.2, 0.12], 0.5), 0.9)
  const grassTop: Look = { tile: GRASS, tint: palette.lush }
  const earthLook: Look = { tile: LITTER, tint: earth }
  const stoneLook: Look = { tile: STONE, tint: mix(palette.highland, palette.peak, 0.4) }
  const sandLook: Look = { tile: SAND, tint: mix(palette.dry, [0.85, 0.75, 0.55], 0.5) }
  const snowLook: Look = { tile: SNOW, tint: palette.ice }
  const iceLook: Look = { tile: SNOW, tint: mix(palette.ice, palette.shallow, 0.4) }
  const basaltLook: Look = { tile: BASALT, tint: [0.3, 0.28, 0.27] }
  const gravelLook: Look = { tile: STONE, tint: mix(palette.highland, [0.5, 0.48, 0.45], 0.5) }
  const woodLook: Look = { tile: LITTER, tint: [0.42, 0.28, 0.16] }
  const woodEnd: Look = { tile: LITTER, tint: [0.6, 0.45, 0.28] }
  const leavesLook: Look = { tile: GRASS, tint: scale(palette.lush, 0.85) }
  const needlesLook: Look = {
    tile: GRASS,
    tint: mix(scale(palette.lush, 0.7), [0.05, 0.2, 0.12], 0.4),
  }
  const cactusLook: Look = { tile: GRASS, tint: [0.3, 0.55, 0.28] }
  const fluid: Look = { tile: STONE, tint: palette.shallow }
  const cacheLook: Look = { tile: BASALT, tint: [0.95, 0.72, 0.2] }
  const lampLook: Look = { tile: LAMP, tint: [1, 0.92, 0.75] }
  const saplingLook: Look = { tile: GRASS, tint: scale(palette.lush, 0.95) }
  const same = (look: Look): readonly [Look, Look, Look] => [look, look, look]
  return {
    air: same(fluid),
    water: same(fluid),
    lava: same(fluid),
    grass: [grassTop, { tile: LITTER, tint: mix(earth, palette.lush, 0.25) }, earthLook],
    earth: same(earthLook),
    stone: same(stoneLook),
    sand: same(sandLook),
    snow: same(snowLook),
    ice: same(iceLook),
    basalt: same(basaltLook),
    gravel: same(gravelLook),
    wood: [woodEnd, woodLook, woodEnd],
    leaves: same(leavesLook),
    needles: same(needlesLook),
    cactus: same(cactusLook),
    cache: same(cacheLook),
    lamp: same(lampLook),
    sapling: same(saplingLook),
  }
}

export interface ChunkMesh {
  readonly positions: Float32Array
  readonly normals: Float32Array
  /** Tint × ambient occlusion, per vertex. */
  readonly colours: Float32Array
  /** Which photograph, per vertex. */
  readonly tiles: Float32Array
  /** Where on it, in blocks: the shader repeats a photograph every few blocks. */
  readonly uvs: Float32Array
  readonly index: Uint32Array
  readonly fluid: {
    readonly positions: Float32Array
    readonly normals: Float32Array
    readonly index: Uint32Array
  }
}

/** The six faces: direction, the two axes across the face, and the four corners. */
const FACES: readonly {
  readonly n: readonly [number, number, number]
  readonly corners: readonly (readonly [number, number, number])[]
  readonly side: 0 | 1 | 2
  readonly uv: readonly [0 | 1 | 2, 0 | 1 | 2]
}[] = [
  // +x, -x, +y, -y, +z, -z; corners anticlockwise seen from outside.
  {
    n: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    side: 1,
    uv: [2, 1],
  },
  {
    n: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    side: 1,
    uv: [2, 1],
  },
  {
    n: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    side: 0,
    uv: [0, 2],
  },
  {
    n: [0, -1, 0],
    corners: [
      [0, 0, 1],
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
    side: 2,
    uv: [0, 2],
  },
  {
    n: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
    side: 1,
    uv: [0, 1],
  },
  {
    n: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    side: 1,
    uv: [0, 1],
  },
]

/** Ambient occlusion for a corner from its three neighbours across the face: 0 to 3 of them solid. */
const AO = [1, 0.8, 0.62, 0.45] as const

/** The mesh of a chunk's visible faces, from its blocks (with halo). */
export function meshChunk(blocks: Uint8Array, palette: Palette): ChunkMesh {
  const looks = looksOf(palette)
  const positions: number[] = []
  const normals: number[] = []
  const colours: number[] = []
  const tiles: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  const fluidPositions: number[] = []
  const fluidNormals: number[] = []
  const fluidIndex: number[] = []

  const idAt = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= HEIGHT || x < -1 || x > CHUNK || z < -1 || z > CHUNK) return 0
    return blocks[at(x, y, z)] ?? 0
  }
  const solidAt = (x: number, y: number, z: number): boolean => SOLID.has(blockOf(idAt(x, y, z)))

  for (let x = 0; x < CHUNK; x += 1) {
    for (let z = 0; z < CHUNK; z += 1) {
      for (let y = 0; y < HEIGHT; y += 1) {
        const block = blockOf(idAt(x, y, z))
        if (block === 'air') continue
        const fluid = FLUID.has(block)
        for (const face of FACES) {
          const nx = x + face.n[0]
          const ny = y + face.n[1]
          const nz = z + face.n[2]
          const beyond = blockOf(idAt(nx, ny, nz))
          if (fluid) {
            // A fluid shows its surface against air only, and never between
            // two fluid blocks; the bottom of the sea is the floor's business.
            if (beyond !== 'air') continue
            const base = fluidPositions.length / 3
            for (const corner of face.corners) {
              // The surface sits a little under the top of its block.
              const dy = face.n[1] === 0 && corner[1] === 1 ? 0.88 : corner[1] === 1 ? 0.88 : 0
              fluidPositions.push(x + corner[0], y + dy, z + corner[2])
              fluidNormals.push(...face.n)
            }
            fluidIndex.push(base, base + 1, base + 2, base, base + 2, base + 3)
            continue
          }
          if (SOLID.has(beyond)) continue
          const look = looks[block][face.side]
          const base = positions.length / 3
          for (const corner of face.corners) {
            positions.push(x + corner[0], y + corner[1], z + corner[2])
            normals.push(...face.n)
            // Occlusion: the two blocks beside this corner across the face,
            // and the one on the diagonal.
            const a = face.n[0] !== 0 ? [0, corner[1] * 2 - 1, 0] : [corner[0] * 2 - 1, 0, 0]
            const b =
              face.n[2] !== 0 || face.n[1] !== 0
                ? face.n[1] !== 0
                  ? [0, 0, corner[2] * 2 - 1]
                  : [0, corner[1] * 2 - 1, 0]
                : [0, 0, corner[2] * 2 - 1]
            const sideA = solidAt(nx + (a[0] ?? 0), ny + (a[1] ?? 0), nz + (a[2] ?? 0))
            const sideB = solidAt(nx + (b[0] ?? 0), ny + (b[1] ?? 0), nz + (b[2] ?? 0))
            const diagonal = solidAt(
              nx + (a[0] ?? 0) + (b[0] ?? 0),
              ny + (a[1] ?? 0) + (b[1] ?? 0),
              nz + (a[2] ?? 0) + (b[2] ?? 0),
            )
            const occluded = sideA && sideB ? 3 : Number(sideA) + Number(sideB) + Number(diagonal)
            const shade = AO[Math.min(3, occluded)] ?? 1
            colours.push(look.tint[0] * shade, look.tint[1] * shade, look.tint[2] * shade)
            tiles.push(look.tile)
            const world = [x + corner[0], y + corner[1], z + corner[2]] as const
            uvs.push(world[face.uv[0]], world[face.uv[1]])
          }
          index.push(base, base + 1, base + 2, base, base + 2, base + 3)
        }
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colours: Float32Array.from(colours),
    tiles: Float32Array.from(tiles),
    uvs: Float32Array.from(uvs),
    index: Uint32Array.from(index),
    fluid: {
      positions: Float32Array.from(fluidPositions),
      normals: Float32Array.from(fluidNormals),
      index: Uint32Array.from(fluidIndex),
    },
  }
}
