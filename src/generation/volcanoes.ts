import type { Vec3 } from './cube'
import { cellCentre, hydrologyOf, neighboursOf } from './hydrology'
import type { Planet } from './planet'

/**
 * Where a molten world's volcanoes smoke: its highest peaks, each a cell
 * of the drainage map higher than every cell round it, the tallest first,
 * kept apart so two summits of one mountain do not both smoke. None on a
 * world that is not molten.
 */
export interface Volcano {
  /** The summit, a unit direction. */
  readonly at: Vec3
  /** 0 to 1, the tallest 1: how big its plume is. */
  readonly heat: number
}

/** The most volcanoes a world smokes from. */
export const MOST_VOLCANOES = 14
/** The nearest two may be, as the cosine of the angle between them (about 0.12 radians). */
const APART = Math.cos(0.12)

export function volcanoesOf(planet: Planet): readonly Volcano[] {
  if (!planet.molten) return []
  const { height } = hydrologyOf(planet)
  const peaks: number[] = []
  for (let cell = 0; cell < height.length; cell += 1) {
    const here = height[cell] ?? 0
    if (here <= 0) continue
    if (neighboursOf(cell).every((next) => (height[next] ?? 0) < here)) peaks.push(cell)
  }
  peaks.sort((a, b) => (height[b] ?? 0) - (height[a] ?? 0))
  const chosen: Vec3[] = []
  const heights: number[] = []
  for (const cell of peaks) {
    if (chosen.length >= MOST_VOLCANOES) break
    const at = cellCentre(cell)
    if (chosen.some((c) => c[0] * at[0] + c[1] * at[1] + c[2] * at[2] > APART)) continue
    chosen.push(at)
    heights.push(height[cell] ?? 0)
  }
  const top = heights[0] ?? 1
  const bottom = heights[heights.length - 1] ?? 0
  return chosen.map((at, k) => ({
    at,
    heat: top > bottom ? 0.4 + (0.6 * ((heights[k] ?? 0) - bottom)) / (top - bottom) : 1,
  }))
}
