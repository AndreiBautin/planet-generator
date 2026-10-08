import type { Vec3 } from './cube'
import {
  CELL_ANGLE,
  cellCentre,
  cellOf,
  hydrologyOf,
  neighboursOf,
  RIVER_FLOW,
  waterAt,
} from './hydrology'
import { surfaceAt, type Planet } from './planet'
import { createRng } from './rng'

/**
 * Where people would live on a world that has them, and the lights they
 * show at night: towns where the drainage map says the living is good — on
 * a coast, by a big river, on low, mild, watered ground — kept apart, the
 * best sites growing largest; each a cluster of lights thickest at its
 * heart, and roads of fainter lights between near neighbours, so the night
 * side reads as a web rather than a scatter.
 *
 * Only temperate and ocean worlds are lived on. None on a molten, frozen
 * or arid one. All of it from the seed, so the same link shows the same
 * towns.
 */
export interface Town {
  readonly at: Vec3
  /** 0 to 1: the biggest is 1. */
  readonly size: number
}

export interface Settlements {
  readonly towns: readonly Town[]
  /**
   * The lights, five numbers each: a unit direction, how bright (0 to 1)
   * and how warm in colour (0 a cold white, 1 sodium orange).
   */
  readonly lights: Float32Array
  /**
   * Where a road crosses water — a river, a lake's narrows — from the last
   * dry ground before it to the first after: a bridge.
   */
  readonly bridges: readonly Bridge[]
}

/** A bridge's two ends, unit directions on either bank. */
export interface Bridge {
  readonly from: Vec3
  readonly to: Vec3
}

/** The longest water a road bridges, in radians; wider, and the road simply stops on either shore. */
export const LONGEST_BRIDGE = 0.012

/**
 * How finely a road is looked along for water, in radians: the narrowest
 * drawn river is about six times this across.
 */
const RIVER_STEP = 0.0003
/** How far a bridge reaches onto the bank either side of the water, in radians. */
const BRIDGE_BANK = 0.0005

const NONE: Settlements = { towns: [], lights: new Float32Array(0), bridges: [] }

/**
 * The glow the towns throw on the ground round them, as a map the width
 * given and half as tall, one byte a texel (RGBA): what a lit town looks
 * like from a glide, where its points are too few to make a place. Laid
 * out as the ground's shader reads a direction (detail.ts, `cityGlow`):
 * u from the angle round the axis, the rows south to north.
 */
export function townGlow(towns: readonly Town[], width: number): Uint8Array {
  const height = width / 2
  const glow = new Float32Array(width * height)
  for (const town of towns) {
    const reach = 0.006 + town.size * 0.02
    const [tx, ty, tz] = town.at
    const polar = Math.acos(Math.max(-1, Math.min(1, ty)))
    const angle = Math.atan2(tz, -tx)
    const rowAt = (1 - polar / Math.PI) * height - 0.5
    const colAt = (angle / (Math.PI * 2) + 0.5) * width - 0.5
    const rows = Math.ceil((reach * 3 * height) / Math.PI) + 1
    const ring = Math.max(0.05, Math.sin(polar))
    const cols = Math.min(width / 2, Math.ceil((reach * 3 * width) / (Math.PI * 2 * ring)) + 1)
    for (let dr = -rows; dr <= rows; dr += 1) {
      const row = Math.round(rowAt) + dr
      if (row < 0 || row >= height) continue
      const p = (1 - (row + 0.5) / height) * Math.PI
      for (let dc = -cols; dc <= cols; dc += 1) {
        const col = (((Math.round(colAt) + dc) % width) + width) % width
        const a = ((col + 0.5) / width - 0.5) * Math.PI * 2
        const x = -Math.cos(a) * Math.sin(p)
        const z = Math.sin(a) * Math.sin(p)
        const y = Math.cos(p)
        const apart = Math.acos(Math.max(-1, Math.min(1, x * tx + y * ty + z * tz)))
        const at = row * width + col
        glow[at] = (glow[at] ?? 0) + (0.35 + town.size * 0.65) * Math.exp(-((apart / reach) ** 2))
      }
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let k = 0; k < glow.length; k += 1) {
    const value = Math.round(Math.min(1, glow[k] ?? 0) * 255)
    data[k * 4] = value
    data[k * 4 + 1] = value
    data[k * 4 + 2] = value
    data[k * 4 + 3] = 255
  }
  return data
}

/** Towns at most, and the nearest two may be (cosine of about 0.05 radians). */
const MOST_TOWNS = 150
const APART = Math.cos(0.05)

const made = new WeakMap<Planet, Settlements>()

export function settlementsOf(planet: Planet): Settlements {
  const known = made.get(planet)
  if (known !== undefined) return known
  const settled = settle(planet)
  made.set(planet, settled)
  return settled
}

function settle(planet: Planet): Settlements {
  if (planet.molten || (planet.kind !== 'temperate' && planet.kind !== 'oceanic')) return NONE
  const rng = createRng(planet.seed).fork('settlements')
  const water = hydrologyOf(planet)
  const { height, flow } = water

  // Score every land cell for how good a place it is to live.
  const scores: number[] = []
  const cells: number[] = []
  for (let cell = 0; cell < height.length; cell += 1) {
    const h = height[cell] ?? 0
    if (h <= 0) continue
    const [x, y, z] = cellCentre(cell)
    const surface = surfaceAt(planet, x, y, z)
    if (surface.biome === 'snow' || surface.biome === 'sea-ice') continue
    const coast = neighboursOf(cell).some((next) => (height[next] ?? 0) <= 0) ? 1 : 0
    const river = Math.max(0, Math.min(1, Math.log2((flow[cell] ?? 0) / RIVER_FLOW) / 3 + 0.3))
    const low = Math.max(0, 1 - h / 0.12)
    const mild = Math.max(0, 1 - Math.abs(surface.warmth - 0.25) * 1.6)
    const score =
      coast * 1.0 + ((flow[cell] ?? 0) >= RIVER_FLOW ? river * 0.9 : 0) + low * 0.6 + mild * 0.7
    // A little chance in it, so the best sites are not all one coast.
    cells.push(cell)
    scores.push(score * mild + rng.next() * 0.35)
  }
  const order = cells.map((_, k) => k).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
  const wanted = Math.round(MOST_TOWNS * (0.45 + rng.next() * 0.55))
  const sites: Vec3[] = []
  for (const k of order) {
    if (sites.length >= wanted) break
    const at = cellCentre(cells[k] ?? 0)
    if (sites.some((s) => s[0] * at[0] + s[1] * at[1] + s[2] * at[2] > APART)) continue
    sites.push(at)
  }
  // The best sites largest, falling off quickly: a few cities, many towns.
  const towns: Town[] = sites.map((at, k) => ({
    at,
    size: Math.max(0.12, Math.pow(1 - k / Math.max(1, sites.length), 2.2)),
  }))

  const lights: number[] = []
  const bridges: Bridge[] = []
  // Dry means off the sea and off the rivers and lakes too: each light is a
  // house when seen close to (render/towns.ts), and one standing in a river
  // channel or on a waterfall's lip was the first thing a low pass showed.
  const near = new Map<number, readonly number[]>()
  const dry = (d: Vec3): boolean => {
    if (surfaceAt(planet, d[0], d[1], d[2]).height <= 0) return false
    const length = Math.hypot(d[0], d[1], d[2]) || 1
    const here = waterAt(planet, water, [d[0] / length, d[1] / length, d[2] / length], near)
    return here.river < 0.2 && !Number.isFinite(here.lake)
  }
  // A river or a lake at a point, without asking about the sea: the costly
  // part of the full test, and a stretch that met the sea skipped a step.
  const inlandWater = (d: Vec3): boolean => {
    const length = Math.hypot(d[0], d[1], d[2]) || 1
    const here = waterAt(planet, water, [d[0] / length, d[1] / length, d[2] / length], near)
    return here.river >= 0.2 || Number.isFinite(here.lake)
  }
  // A house wants dry ground round it, not only under it: the river's
  // channel is carved and its sheet drawn a vertex past the water's edge,
  // so a light just off the river stood as a house in the drawn water.
  const clear = (d: Vec3): boolean => {
    for (let k = 0; k < 4; k += 1) {
      if (!dry(offset(d, (k * Math.PI) / 2, HOUSE_MARGIN))) return false
    }
    return true
  }
  const light = (d: Vec3, bright: number, warm: number): void => {
    const length = Math.hypot(d[0], d[1], d[2]) || 1
    lights.push(d[0] / length, d[1] / length, d[2] / length, bright, warm)
  }
  /** A direction `angle` radians from `from`, setting off `bearing` round it. */
  const offset = (from: Vec3, bearing: number, angle: number): Vec3 => {
    const [ux, uy, uz] = from
    const side: Vec3 = Math.abs(uy) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const ax = uy * side[2] - uz * side[1]
    const ay = uz * side[0] - ux * side[2]
    const az = ux * side[1] - uy * side[0]
    const al = Math.hypot(ax, ay, az) || 1
    const e1: Vec3 = [ax / al, ay / al, az / al]
    const e2: Vec3 = [uy * e1[2] - uz * e1[1], uz * e1[0] - ux * e1[2], ux * e1[1] - uy * e1[0]]
    const c = Math.cos(bearing) * angle
    const s = Math.sin(bearing) * angle
    return [ux + e1[0] * c + e2[0] * s, uy + e1[1] * c + e2[1] * s, uz + e1[2] * c + e2[2] * s]
  }

  for (const town of towns) {
    const own = rng.fork(`town-${String(lights.length)}`)
    const count = Math.round(14 + town.size * 170)
    const spread = 0.0025 + town.size * 0.009
    for (let k = 0; k < count; k += 1) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // Gaussian round the heart: dense in the middle, thinning out.
        const radius = spread * Math.sqrt(-2 * Math.log(Math.max(1e-6, own.next()))) * 0.6
        const d = offset(town.at, own.next() * Math.PI * 2, radius)
        if (!dry(d) || !clear(d)) continue
        light(
          d,
          0.45 + own.next() * 0.55,
          own.next() < 0.7 ? 0.8 + own.next() * 0.2 : own.next() * 0.3,
        )
        break
      }
    }
  }

  // Roads: each town to its two nearest neighbours not too far off.
  const joined = new Set<string>()
  towns.forEach((town, i) => {
    const near = towns
      .map((other, j) => ({
        j,
        d: town.at[0] * other.at[0] + town.at[1] * other.at[1] + town.at[2] * other.at[2],
      }))
      .filter((n) => n.j !== i && n.d > Math.cos(0.22))
      .sort((a, b) => b.d - a.d)
      .slice(0, 2)
    for (const { j } of near) {
      const key = i < j ? `${String(i)}-${String(j)}` : `${String(j)}-${String(i)}`
      if (joined.has(key)) continue
      joined.add(key)
      const other = towns[j]?.at ?? town.at
      const angle = Math.acos(
        Math.min(1, town.at[0] * other[0] + town.at[1] * other[1] + town.at[2] * other[2]),
      )
      const steps = Math.max(2, Math.round(angle / 0.0028))
      const road = rng.fork(`road-${key}`)
      // A road bends a little, so it is not a ruled line between the two.
      const bend = (road.next() - 0.5) * 0.25
      // The last dry ground the road passed, and whether it has gone over
      // water since: on the next dry step, that stretch is a bridge.
      let bank: Vec3 = town.at
      let wet = false
      const landed = (d: Vec3): void => {
        // The lights of a road scatter either side of its line, so two in a
        // row can be well over a bridge's length apart with only a river
        // between: the bridge spans the water alone, found by looking along
        // the stretch, with a little bank at each end. Spanning light to
        // light, all but one of a world's crossings came out too long.
        const span = angleBetween(bank, d)
        // A stretch that skipped a step crossed something wide — sea, lake
        // or river — and is looked along with the full test; one that did not
        // only for a river or a lake, which is cheap where there is none.
        const wetAt = wet ? (p: Vec3): boolean => !dry(p) : inlandWater
        let first = -1
        let last = -1
        const step = RIVER_STEP / Math.max(span, 1e-9)
        for (let t = step; t < 1; t += step) {
          if (!wetAt(along(bank, d, t))) continue
          if (first < 0) first = t
          last = t
        }
        if (first >= 0) {
          const from = Math.max(0, first - BRIDGE_BANK / Math.max(span, 1e-9))
          const to = Math.min(1, last + BRIDGE_BANK / Math.max(span, 1e-9))
          if ((to - from) * span < LONGEST_BRIDGE)
            bridges.push({ from: along(bank, d, from), to: along(bank, d, to) })
        }
        bank = d
        wet = false
      }
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps
        const sway = Math.sin(t * Math.PI) * bend * angle
        const p: Vec3 = [
          town.at[0] * (1 - t) + other[0] * t,
          town.at[1] * (1 - t) + other[1] * t,
          town.at[2] * (1 - t) + other[2] * t,
        ]
        const d = offset(p, road.next() * Math.PI * 2, Math.abs(sway) * 0.3 + road.next() * 0.0006)
        if (!dry(d)) {
          wet = true
          continue
        }
        landed(d)
        light(d, 0.22 + road.next() * 0.2, 0.9)
      }
      landed(other)
    }
  })

  return { towns, lights: Float32Array.from(lights), bridges }
}

/** How a point stands to a world's towns: under a house (0 to 1), and in a town's fields (0 to 1). */
export interface TownCover {
  readonly house: number
  readonly farm: number
}

/** How near a house must be, in radians, to clear the trees over a point: a garden's width. */
const HOUSE_REACH = 0.0007
const OPEN: TownCover = { house: 0, farm: 0 }
const covers = new WeakMap<Planet, ((d: Vec3) => TownCover) | undefined>()

/**
 * A world's towns as the ground sees them, for the worker that builds the
 * ground (render/patches/patch-data.ts): `house` near a town's light, which
 * is a house (render/towns.ts) — clear the trees there — and `farm` in the
 * ring of fields round each town, out past its houses. Bucketed by the
 * cells of the drainage map so a point asks only about the towns and
 * houses near it. Nothing on an unsettled world.
 */
export function townCoverOf(planet: Planet): ((d: Vec3) => TownCover) | undefined {
  if (covers.has(planet)) return covers.get(planet)
  const { towns, lights } = settlementsOf(planet)
  if (towns.length === 0) {
    covers.set(planet, undefined)
    return undefined
  }
  const neighbours = new Map<number, readonly number[]>()
  const around = (cell: number): readonly number[] => {
    let near = neighbours.get(cell)
    if (near === undefined) {
      near = [cell, ...neighboursOf(cell)]
      neighbours.set(cell, near)
    }
    return near
  }
  const houses = new Map<number, number[]>()
  for (let k = 0; k + 4 < lights.length; k += 5) {
    if ((lights[k + 3] ?? 0) < TOWN_LIGHT) continue
    const d: Vec3 = [lights[k] ?? 0, lights[k + 1] ?? 0, lights[k + 2] ?? 1]
    const cell = cellOf(d)
    const list = houses.get(cell) ?? []
    list.push(d[0], d[1], d[2])
    houses.set(cell, list)
  }
  // Each town listed in every cell its fields can reach.
  const fields = new Map<number, number[]>()
  towns.forEach((town, index) => {
    const reach = farmReach(town)
    const seen = new Set<number>()
    let ring = [cellOf(town.at)]
    for (let step = 0; step <= Math.ceil(reach / CELL_ANGLE) + 1; step += 1) {
      const next: number[] = []
      for (const cell of ring) {
        if (seen.has(cell)) continue
        seen.add(cell)
        const list = fields.get(cell) ?? []
        list.push(index)
        fields.set(cell, list)
        next.push(...around(cell))
      }
      ring = next
    }
  })
  const cover = (d: Vec3): TownCover => {
    const cell = cellOf(d)
    let house = 0
    for (const near of around(cell)) {
      const list = houses.get(near)
      if (list === undefined) continue
      for (let k = 0; k < list.length; k += 3) {
        const dot = d[0] * (list[k] ?? 0) + d[1] * (list[k + 1] ?? 0) + d[2] * (list[k + 2] ?? 0)
        if (dot < 0.9999) continue
        const apart = Math.acos(Math.min(1, dot))
        house = Math.max(house, Math.exp(-((apart / HOUSE_REACH) ** 2)))
      }
    }
    let farm = 0
    for (const index of fields.get(cell) ?? []) {
      const town = towns[index]
      if (town === undefined) continue
      const apart = Math.acos(
        Math.min(1, d[0] * town.at[0] + d[1] * town.at[1] + d[2] * town.at[2]),
      )
      const reach = farmReach(town)
      farm = Math.max(farm, 1 - smoothRange(reach * 0.6, reach, apart))
    }
    return house === 0 && farm === 0 ? OPEN : { house, farm }
  }
  covers.set(planet, cover)
  return cover
}

/** How far out a town's fields run, in radians: a little past its houses. */
const farmReach = (town: Town): number => (0.0025 + town.size * 0.009) * 2.4

/** The brightness that tells a town's light from a road's (roads stop at 0.42). */
/** How far round a house the ground must be dry, radians: past the river sheet's reach and the carved bank. */
export const HOUSE_MARGIN = 0.0006
export const TOWN_LIGHT = 0.44

function smoothRange(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))

/** The point `t` of the way from `a` to `b`, as a unit direction. */
function along(a: Vec3, b: Vec3, t: number): Vec3 {
  const p: Vec3 = [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t]
  const l = Math.hypot(p[0], p[1], p[2]) || 1
  return [p[0] / l, p[1] / l, p[2] / l]
}
