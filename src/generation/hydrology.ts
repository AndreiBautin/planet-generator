import { directionOn, patchAt, type Face, type Vec3 } from './cube'
import { fbm } from './noise'
import { surfaceAt, type Planet } from './planet'

/**
 * Where the water goes: rivers and lakes for a whole planet, worked out
 * once on a grid laid over the cube-sphere and read by every patch.
 *
 * The grid is the patches' own at level 7 — 6 × 128 × 128 cells, a cell
 * about seven tenths of a degree across. The sea is flooded inwards from
 * the coast by height, lowest first (a priority flood): each cell drains
 * to the one it was reached from, which is always downhill or level, and
 * a hollow fills to the height of its lowest rim, which is a lake. Then
 * rain is gathered downstream, every cell passing on what it has, and a
 * river is any run of cells carrying enough.
 *
 * Done once, deterministically, from the planet alone, so every worker and
 * every patch agrees, and a river is part of the ground from the first
 * patch that holds it: nothing about it arrives late.
 */
export const HYDRO_LEVEL = 7
const SIDE = 2 ** HYDRO_LEVEL
const CELLS = 6 * SIDE * SIDE

/** Flow, in cells' worth of rain, above which a run of cells is a river. */
export const RIVER_FLOW = 60

/**
 * How deep a filled hollow must be to be drawn as a lake. A shallower one
 * is still filled so the water flows on across it, but drawn it would be a
 * sheet of shallows a few thousandths deep flooding a whole river valley.
 */
export const LAKE_DEPTH = 0.015

export interface Hydrology {
  /** The ground's height in each cell (surface units: sea level is nought). */
  readonly height: Float32Array
  /** The water level a lake holds in each cell; minus infinity where there is none. */
  readonly lake: Float32Array
  /** Rain gathered into each cell from everything upstream of it. */
  readonly flow: Float32Array
  /** The cell each drains into; −1 at sea. */
  readonly receiver: Int32Array
  /** Each cell's centre, three to a cell: read for every river segment, so kept. */
  readonly centres: Float32Array
}

const NONE = Number.NEGATIVE_INFINITY

export const cellIndex = (face: Face, x: number, y: number): number => (face * SIDE + y) * SIDE + x

/** The cell holding a direction. */
export function cellOf(direction: Vec3): number {
  const key = patchAt(direction, HYDRO_LEVEL)
  return cellIndex(key.face, key.x, key.y)
}

/** A cell's centre, as a unit direction. */
export function cellCentre(cell: number): Vec3 {
  const x = cell % SIDE
  const y = Math.floor(cell / SIDE) % SIDE
  const face = Math.floor(cell / (SIDE * SIDE)) as Face
  return directionOn(face, -1 + ((x + 0.5) * 2) / SIDE, -1 + ((y + 0.5) * 2) / SIDE)
}

/** The eight cells round one, across face edges where it is on one. */
export function neighboursOf(cell: number): number[] {
  const x = cell % SIDE
  const y = Math.floor(cell / SIDE) % SIDE
  const face = Math.floor(cell / (SIDE * SIDE)) as Face
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const u = -1 + ((x + 0.5 + dx) * 2) / SIDE
      const v = -1 + ((y + 0.5 + dy) * 2) / SIDE
      const neighbour = cellOf(directionOn(face, u, v))
      if (neighbour !== cell && !out.includes(neighbour)) out.push(neighbour)
    }
  }
  return out
}

/**
 * The floor of the ground round a point: the drainage map's heights over
 * two rings of cells about it, the nearer weighing more, the sea read as
 * its shore — their mean, less `spread` of their standard deviation. A
 * hollow lies under it, a slope across it, a ridge over it. What dawn
 * mist fills a valley up from.
 *
 * Not a minimum, even a soft one: a deep cell joining the rings as the
 * point crossed a cell edge took the minimum over the moment it carried
 * any weight at all, and the mist's edge stepped. A mean and a spread move
 * only as fast as the weights do, and those fall to nothing at the rings'
 * edge.
 */
export function floorHeightAt(
  water: Hydrology,
  direction: Vec3,
  near: Map<number, readonly number[]>,
  spread: number,
): number {
  const cell = cellOf(direction)
  let around = near.get(cell)
  if (around === undefined) {
    const ring = new Set<number>([cell])
    for (const first of neighboursOf(cell)) {
      ring.add(first)
      for (const second of neighboursOf(first)) ring.add(second)
    }
    around = [...ring]
    near.set(cell, around)
  }
  const length = Math.hypot(...direction) || 1
  const x = direction[0] / length
  const y = direction[1] / length
  const z = direction[2] / length
  const c = water.centres
  let sum = 0
  let squares = 0
  let weights = 0
  for (const k of around) {
    const gap =
      Math.hypot(x - (c[k * 3] ?? 0), y - (c[k * 3 + 1] ?? 0), z - (c[k * 3 + 2] ?? 0)) / CELL_SPAN
    const weight = Math.max(0, 1 - gap / FLOOR_REACH) ** 2
    const h = Math.max(0, water.height[k] ?? 0)
    sum += weight * h
    squares += weight * h * h
    weights += weight
  }
  if (weights <= 0) return 0
  const mean = sum / weights
  return mean - spread * Math.sqrt(Math.max(0, squares / weights - mean * mean))
}

/** How far, in cells, the floor's weights reach: short of the third ring, which is never read. */
const FLOOR_REACH = 2.4
/** A cell's width, as an angle (as `CELL_ANGLE`, declared before the functions that use it first). */
const CELL_SPAN = Math.PI / 2 / SIDE

/** A binary heap of cells by priority, lowest first. */
class Queue {
  private readonly cells: number[] = []
  private readonly keys: number[] = []
  get size(): number {
    return this.cells.length
  }
  push(cell: number, key: number): void {
    let at = this.cells.length
    this.cells.push(cell)
    this.keys.push(key)
    while (at > 0) {
      const up = (at - 1) >> 1
      if ((this.keys[up] ?? 0) <= key) break
      this.cells[at] = this.cells[up] ?? 0
      this.keys[at] = this.keys[up] ?? 0
      at = up
    }
    this.cells[at] = cell
    this.keys[at] = key
  }
  pop(): number {
    const top = this.cells[0] ?? -1
    const lastCell = this.cells.pop() ?? 0
    const lastKey = this.keys.pop() ?? 0
    if (this.cells.length > 0) {
      let at = 0
      const count = this.cells.length
      for (;;) {
        const left = at * 2 + 1
        if (left >= count) break
        const right = left + 1
        const child =
          right < count && (this.keys[right] ?? 0) < (this.keys[left] ?? 0) ? right : left
        if ((this.keys[child] ?? 0) >= lastKey) break
        this.cells[at] = this.cells[child] ?? 0
        this.keys[at] = this.keys[child] ?? 0
        at = child
      }
      this.cells[at] = lastCell
      this.keys[at] = lastKey
    }
    return top
  }
}

const made = new WeakMap<Planet, Hydrology>()

export function hydrologyOf(planet: Planet): Hydrology {
  const known = made.get(planet)
  if (known !== undefined) return known
  const height = new Float32Array(CELLS)
  const centres = new Float32Array(CELLS * 3)
  const wet = new Float32Array(CELLS)
  for (let cell = 0; cell < CELLS; cell += 1) {
    const [cx, cy, cz] = cellCentre(cell)
    centres[cell * 3] = cx
    centres[cell * 3 + 1] = cy
    centres[cell * 3 + 2] = cz
    const surface = surfaceAt(planet, cx, cy, cz)
    height[cell] = surface.height
    // Rain: more where it is wet, none where it falls as snow that stays.
    wet[cell] = surface.biome === 'snow' ? 0.2 : 0.3 + surface.moisture
  }

  // Flood from the sea inwards, lowest first.
  const filled = new Float32Array(CELLS)
  const receiver = new Int32Array(CELLS).fill(-1)
  const seen = new Uint8Array(CELLS)
  const order: number[] = []
  const queue = new Queue()
  for (let cell = 0; cell < CELLS; cell += 1) {
    if ((height[cell] ?? 0) < 0) {
      seen[cell] = 1
      filled[cell] = 0
      queue.push(cell, 0)
    }
  }
  if (queue.size === 0) {
    // No sea: everything drains to the lowest point, which holds a lake.
    let lowest = 0
    for (let cell = 1; cell < CELLS; cell += 1) {
      if ((height[cell] ?? 0) < (height[lowest] ?? 0)) lowest = cell
    }
    seen[lowest] = 1
    filled[lowest] = height[lowest] ?? 0
    queue.push(lowest, filled[lowest] ?? 0)
  }
  while (queue.size > 0) {
    const cell = queue.pop()
    const level = filled[cell] ?? 0
    for (const neighbour of neighboursOf(cell)) {
      if (seen[neighbour] === 1) continue
      seen[neighbour] = 1
      // A cell lower than the rim it was reached over is under a lake.
      const own = Math.max(height[neighbour] ?? 0, level + 1e-6)
      filled[neighbour] = own
      receiver[neighbour] = (height[neighbour] ?? 0) < 0 ? -1 : cell
      order.push(neighbour)
      queue.push(neighbour, own)
    }
  }

  const lake = new Float32Array(CELLS).fill(NONE)
  const grow: number[] = []
  for (let cell = 0; cell < CELLS; cell += 1) {
    const floor = height[cell] ?? 0
    if (floor >= 0 && (filled[cell] ?? 0) > floor + LAKE_DEPTH) {
      lake[cell] = filled[cell] ?? NONE
      grow.push(cell)
    }
  }
  // A lake is deep enough to count somewhere, but it fills its whole
  // hollow: out over the shallow cells round it, at its own level, to where
  // the ground rises out of it. Stopped at the deep cells, the water ended
  // where the grid did and every shore was a staircase of cell edges.
  while (grow.length > 0) {
    const cell = grow.pop() ?? 0
    const level = lake[cell] ?? NONE
    for (const next of neighboursOf(cell)) {
      const floor = height[next] ?? 0
      if (floor < 0 || Number.isFinite(lake[next] ?? NONE)) continue
      if ((filled[next] ?? 0) > floor && Math.abs((filled[next] ?? 0) - level) < 1e-3) {
        lake[next] = level
        grow.push(next)
      }
    }
  }

  // Rain gathered downstream: upstream cells come last in the flood, so
  // walking it backwards passes each cell's water on before its receiver's.
  const flow = new Float32Array(CELLS)
  for (let cell = 0; cell < CELLS; cell += 1) {
    if ((height[cell] ?? 0) >= 0) flow[cell] = wet[cell] ?? 0
  }
  for (let at = order.length - 1; at >= 0; at -= 1) {
    const cell = order[at] ?? 0
    const down = receiver[cell] ?? -1
    if (down >= 0) flow[down] = (flow[down] ?? 0) + (flow[cell] ?? 0)
  }

  const hydrology: Hydrology = { height, lake, flow, receiver, centres }
  made.set(planet, hydrology)
  return hydrology
}

/** A cell's width, as an angle: a quarter turn over the cells along a face. */
const CELL_ANGLE = Math.PI / 2 / SIDE

export interface WaterHere {
  /** How far the ground is cut down for a river bed, in surface-height units. */
  readonly carve: number
  /** 0 to 1: how much of a river this point is, 1 in its channel. */
  readonly river: number
  /** The level a lake nearby holds, or minus infinity. */
  readonly lake: number
}

const DRY: WaterHere = { carve: 0, river: 0, lake: NONE }

/**
 * The water at a point: the nearest river channel among the cells round it,
 * each a segment from a cell's centre to its receiver's, wandered by a
 * noise so a river meanders rather than ruling straight lines between
 * cell centres; and the level of any lake in those cells.
 *
 * `near` caches each cell's neighbours for the caller, since a patch asks
 * about the same few cells over and over.
 */
export function waterAt(
  planet: Planet,
  water: Hydrology,
  direction: Vec3,
  near: Map<number, readonly number[]>,
): WaterHere {
  const [x, y, z] = direction
  const cell = cellOf(direction)
  let around = near.get(cell)
  if (around === undefined) {
    around = [cell, ...neighboursOf(cell)]
    near.set(cell, around)
  }
  // Lakes and river segments among the cells round this one first: most
  // ground has neither, and the meander noise below is the costly part.
  let lake = NONE
  const rivers: number[] = []
  for (const k of around) {
    lake = Math.max(lake, water.lake[k] ?? NONE)
    const down = water.receiver[k] ?? -1
    if (down >= 0 && (water.flow[k] ?? 0) >= RIVER_FLOW && (water.height[k] ?? 0) > 0)
      rivers.push(k)
  }
  if (rivers.length === 0) return Number.isFinite(lake) ? { carve: 0, river: 0, lake } : DRY
  const [ox, oy, oz] = planet.offset
  const wander = CELL_ANGLE * 0.35
  const px = x + fbm(planet.fine, (x + oy) * 260, (y + oz) * 260, (z + ox) * 260, 3) * wander
  const py = y + fbm(planet.fine, (y - ox) * 260, (z - oy) * 260, (x - oz) * 260, 3) * wander
  const pz = z + fbm(planet.fine, (z + oz) * 260, (x - ox) * 260, (y + oy) * 260, 3) * wander
  let nearest = Number.POSITIVE_INFINITY
  let strength = 0
  const c = water.centres
  for (const k of rivers) {
    const down = water.receiver[k] ?? 0
    const flow = water.flow[k] ?? 0
    const ax = c[k * 3] ?? 0
    const ay = c[k * 3 + 1] ?? 0
    const az = c[k * 3 + 2] ?? 0
    const bx = c[down * 3] ?? 0
    const by = c[down * 3 + 1] ?? 0
    const bz = c[down * 3 + 2] ?? 0
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const t = Math.min(
      1,
      Math.max(
        0,
        ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / (ux * ux + uy * uy + uz * uz || 1),
      ),
    )
    const gap = Math.hypot(px - ax - ux * t, py - ay - uy * t, pz - az - uz * t)
    // Wider downstream, as the water gathered grows.
    const width = CELL_ANGLE * Math.min(0.4, 0.05 + 0.07 * Math.sqrt(flow / RIVER_FLOW))
    const reach = gap / width
    if (reach < nearest) {
      nearest = reach
      strength = Math.min(1, Math.log2(flow / RIVER_FLOW) / 4 + 0.25)
    }
  }
  const river = 1 - smooth(0.6, 1.4, nearest)
  return { carve: river * (0.012 + 0.018 * strength), river, lake }
}

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}
