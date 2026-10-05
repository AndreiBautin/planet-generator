import type { Vec3 } from './cube'
import { surfaceAt, type Planet } from './planet'

/**
 * A survey of a world: the few places on it worth naming. The highest
 * peak, the deepest valley, the heart of the widest sea (lava, on a molten
 * world), the heart of the pack ice, the heart of the widest land. Read
 * off a coarse grid of the whole sphere, so a survey costs about a tenth
 * of a second once and never again for that seed.
 *
 * Pure and stable: the same planet surveys the same, because every
 * landmark is the extreme of a deterministic field over a fixed grid. The
 * cache is placed by a rule over these, and the clue names them, so a
 * landmark that moved would move the cache out from under its clue.
 */
export const LANDMARK_KINDS = ['peak', 'valley', 'sea', 'lava', 'ice', 'land'] as const
export type LandmarkKind = (typeof LANDMARK_KINDS)[number]

export interface Landmark {
  readonly kind: LandmarkKind
  /** Where it is, a unit direction. */
  readonly direction: Vec3
  /** The ground's height there, in `surfaceAt`'s units. */
  readonly height: number
  /** For a region, its share of the sphere; for a point, nought. */
  readonly share: number
}

export type Survey = readonly Landmark[]

/** How the landmark is named in a clue. */
export const LANDMARK_PHRASES: Readonly<Record<LandmarkKind, string>> = {
  peak: 'the highest peak',
  valley: 'the deepest valley',
  sea: 'the heart of the widest sea',
  lava: 'the heart of the lava sea',
  ice: 'the heart of the pack ice',
  land: 'the heart of the widest land',
}

/** Columns and rows of the survey grid, in longitude and latitude. */
export const SURVEY_WIDTH = 180
export const SURVEY_HEIGHT = 90

/** The unit direction of a grid cell's centre; `y` is the spin axis. */
export function surveyDirection(column: number, row: number): Vec3 {
  const latitude = -Math.PI / 2 + ((row + 0.5) * Math.PI) / SURVEY_HEIGHT
  const longitude = ((column + 0.5) * 2 * Math.PI) / SURVEY_WIDTH
  const flat = Math.cos(latitude)
  return [flat * Math.cos(longitude), Math.sin(latitude), flat * Math.sin(longitude)]
}

const cellWeight = (row: number): number =>
  Math.cos(-Math.PI / 2 + ((row + 0.5) * Math.PI) / SURVEY_HEIGHT)

const index = (column: number, row: number): number => row * SURVEY_WIDTH + column

interface Region {
  readonly cells: readonly number[]
  readonly share: number
}

/**
 * Connected regions of the cells a predicate admits, four-connected, with
 * longitude wrapping; the poles do not join across the top row, which
 * splits a polar cap into at most a few pieces and is accepted.
 */
function regionsOf(admit: (cell: number) => boolean): Region[] {
  const seen = new Uint8Array(SURVEY_WIDTH * SURVEY_HEIGHT)
  const regions: Region[] = []
  let total = 0
  for (let row = 0; row < SURVEY_HEIGHT; row += 1) total += cellWeight(row) * SURVEY_WIDTH
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] === 1 || !admit(start)) continue
    const cells: number[] = []
    const queue = [start]
    seen[start] = 1
    let weight = 0
    while (queue.length > 0) {
      const cell = queue.pop() as number
      cells.push(cell)
      const row = Math.floor(cell / SURVEY_WIDTH)
      const column = cell - row * SURVEY_WIDTH
      weight += cellWeight(row)
      const neighbours = [
        index((column + 1) % SURVEY_WIDTH, row),
        index((column + SURVEY_WIDTH - 1) % SURVEY_WIDTH, row),
        row > 0 ? index(column, row - 1) : -1,
        row < SURVEY_HEIGHT - 1 ? index(column, row + 1) : -1,
      ]
      for (const next of neighbours) {
        if (next < 0 || seen[next] === 1 || !admit(next)) continue
        seen[next] = 1
        queue.push(next)
      }
    }
    regions.push({ cells, share: weight / total })
  }
  return regions
}

/** The cell of a region farthest from its edge: its heart. */
function heartOf(region: Region, admit: (cell: number) => boolean): number {
  const inside = new Set(region.cells)
  const distance = new Map<number, number>()
  let frontier: number[] = []
  for (const cell of region.cells) {
    const row = Math.floor(cell / SURVEY_WIDTH)
    const column = cell - row * SURVEY_WIDTH
    const edge =
      row === 0 ||
      row === SURVEY_HEIGHT - 1 ||
      !admit(index((column + 1) % SURVEY_WIDTH, row)) ||
      !admit(index((column + SURVEY_WIDTH - 1) % SURVEY_WIDTH, row)) ||
      !admit(index(column, row - 1)) ||
      !admit(index(column, row + 1))
    if (edge) {
      distance.set(cell, 0)
      frontier.push(cell)
    }
  }
  let farthest = region.cells[0] ?? 0
  let depth = 0
  while (frontier.length > 0) {
    const next: number[] = []
    for (const cell of frontier) {
      const here = distance.get(cell) ?? 0
      const row = Math.floor(cell / SURVEY_WIDTH)
      const column = cell - row * SURVEY_WIDTH
      for (const step of [
        index((column + 1) % SURVEY_WIDTH, row),
        index((column + SURVEY_WIDTH - 1) % SURVEY_WIDTH, row),
        row > 0 ? index(column, row - 1) : -1,
        row < SURVEY_HEIGHT - 1 ? index(column, row + 1) : -1,
      ]) {
        if (step < 0 || !inside.has(step) || distance.has(step)) continue
        distance.set(step, here + 1)
        next.push(step)
        if (here + 1 > depth || (here + 1 === depth && step < farthest)) {
          depth = here + 1
          farthest = step
        }
      }
    }
    frontier = next
  }
  return farthest
}

/** Survey a world: sample the grid once, then read the landmarks off it. */
export function surveyPlanet(planet: Planet): Survey {
  const count = SURVEY_WIDTH * SURVEY_HEIGHT
  const heights = new Float32Array(count)
  const sea = new Uint8Array(count)
  const ice = new Uint8Array(count)
  for (let row = 0; row < SURVEY_HEIGHT; row += 1) {
    for (let column = 0; column < SURVEY_WIDTH; column += 1) {
      const [x, y, z] = surveyDirection(column, row)
      const surface = surfaceAt(planet, x, y, z)
      const cell = index(column, row)
      heights[cell] = surface.height
      if (surface.height < 0) sea[cell] = 1
      if (surface.biome === 'sea-ice') ice[cell] = 1
    }
  }
  const at = (cell: number): Landmark['direction'] =>
    surveyDirection(cell % SURVEY_WIDTH, Math.floor(cell / SURVEY_WIDTH))
  const heightAt = (cell: number): number => heights[cell] ?? 0
  const landmarks: Landmark[] = []

  // The peak: the highest cell anywhere.
  let peak = 0
  for (let cell = 1; cell < count; cell += 1) if (heightAt(cell) > heightAt(peak)) peak = cell
  landmarks.push({ kind: 'peak', direction: at(peak), height: heightAt(peak), share: 0 })

  // The valley: the land cell that sits deepest below its neighbours, away
  // from the shore so a beach does not read as a valley.
  let valley = -1
  let drop = 0
  for (let row = 1; row < SURVEY_HEIGHT - 1; row += 1) {
    for (let column = 0; column < SURVEY_WIDTH; column += 1) {
      const cell = index(column, row)
      if (heightAt(cell) < 0.03) continue
      let around = 0
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        around += heightAt(index((column + dc + SURVEY_WIDTH) % SURVEY_WIDTH, row + dr))
      }
      const below = around / 8 - heightAt(cell)
      if (below > drop) {
        drop = below
        valley = cell
      }
    }
  }
  if (valley >= 0)
    landmarks.push({ kind: 'valley', direction: at(valley), height: heightAt(valley), share: 0 })

  const largest = (regions: readonly Region[]): Region | undefined => {
    let best: Region | undefined
    for (const region of regions) if (best === undefined || region.share > best.share) best = region
    return best
  }
  const isSea = (cell: number): boolean => sea[cell] === 1
  const widestSea = largest(regionsOf(isSea))
  if (widestSea !== undefined) {
    const heart = heartOf(widestSea, isSea)
    landmarks.push({
      kind: planet.molten ? 'lava' : 'sea',
      direction: at(heart),
      height: heightAt(heart),
      share: widestSea.share,
    })
  }
  const isIce = (cell: number): boolean => ice[cell] === 1
  const widestIce = largest(regionsOf(isIce))
  if (widestIce !== undefined && widestIce.share > 0.01) {
    const heart = heartOf(widestIce, isIce)
    landmarks.push({
      kind: 'ice',
      direction: at(heart),
      height: heightAt(heart),
      share: widestIce.share,
    })
  }
  const isLand = (cell: number): boolean => sea[cell] === 0
  const widestLand = largest(regionsOf(isLand))
  if (widestLand !== undefined) {
    const heart = heartOf(widestLand, isLand)
    landmarks.push({
      kind: 'land',
      direction: at(heart),
      height: heightAt(heart),
      share: widestLand.share,
    })
  }
  return landmarks
}

/** The angle between two unit directions, in radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return Math.acos(Math.min(1, Math.max(-1, d)))
}
