import type { Vec3 } from './cube'
import { CELL_ANGLE, hydrologyOf, RIVER_FLOW, waterAt } from './hydrology'
import { FREEZES } from './features'
import { surfaceAt, type Planet } from './planet'

/**
 * Where a world's rivers fall: the steepest drops along its rivers, each
 * placed at the foot of its fall, on the channel as it is drawn, where the
 * spray rises from the plunge pool. The white water itself is the river's
 * own (render/patches/patch-data.ts, `rapids`); these are only where it
 * lands hard enough to throw up mist.
 */
export interface Waterfall {
  /** The foot of the fall, a unit direction on the river. */
  readonly at: Vec3
  /** 0 to 1, the tallest 1: how much spray it throws. */
  readonly drop: number
}

/** The most falls a world sprays from. */
export const MOST_FALLS = 20
/** How far a river must fall from one cell of the drainage map to the next to throw spray, in surface units. */
export const FALL_DROP = 0.05
/** The nearest two may be, as the cosine of the angle between them (about 0.03 radians). */
const APART = Math.cos(0.03)
/** How far above freezing a fall must be to run: past where the water starts to ice (features.ts). */
const THAWED = 0.3
/** How much of a river the foot must be (hydrology.ts, `river`) to count as on it. */
const ON_RIVER = 0.6

export function waterfallsOf(planet: Planet): readonly Waterfall[] {
  if (planet.molten) return []
  const water = hydrologyOf(planet)
  const { height, flow, receiver, centres } = water
  const steep: { cell: number; drop: number }[] = []
  for (let cell = 0; cell < flow.length; cell += 1) {
    const down = receiver[cell] ?? -1
    if (down < 0 || (flow[cell] ?? 0) < RIVER_FLOW || (height[cell] ?? 0) <= 0) continue
    // Into the sea counts from sea level: a river off a sea cliff falls too.
    const drop = (height[cell] ?? 0) - Math.max(0, height[down] ?? 0)
    if (drop >= FALL_DROP) steep.push({ cell, drop })
  }
  steep.sort((a, b) => b.drop - a.drop)
  const tallest = steep[0]?.drop ?? 1
  const near = new Map<number, readonly number[]>()
  const falls: Waterfall[] = []
  for (const { cell, drop } of steep) {
    if (falls.length >= MOST_FALLS) break
    const down = receiver[cell] ?? 0
    // Three quarters of the way down the segment, then onto the channel as
    // drawn, which wanders off the straight line between the cell centres
    // (hydrology.ts, `waterAt`): the strongest river within half a cell.
    const t = 0.75
    const guess: Vec3 = [
      (centres[cell * 3] ?? 0) * (1 - t) + (centres[down * 3] ?? 0) * t,
      (centres[cell * 3 + 1] ?? 0) * (1 - t) + (centres[down * 3 + 1] ?? 0) * t,
      (centres[cell * 3 + 2] ?? 1) * (1 - t) + (centres[down * 3 + 2] ?? 1) * t,
    ]
    const foot = onChannel(planet, water, unit(guess), near)
    if (foot === undefined) continue
    // A river on snow lies frozen (patch-data.ts), and one cold enough to
    // ice over has no spray to throw (patch-data.ts, `ice`): nothing falls.
    const surface = surfaceAt(planet, foot[0], foot[1], foot[2])
    if (surface.biome === 'snow' || surface.warmth < FREEZES + THAWED) continue
    if (falls.some(({ at }) => at[0] * foot[0] + at[1] * foot[1] + at[2] * foot[2] > APART))
      continue
    falls.push({ at: foot, drop: Math.min(1, drop / tallest) })
  }
  return falls
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The point most in the river on a small grid round `guess`, if any is in it. */
function onChannel(
  planet: Planet,
  water: ReturnType<typeof hydrologyOf>,
  guess: Vec3,
  near: Map<number, readonly number[]>,
): Vec3 | undefined {
  const east = unit(Math.abs(guess[1]) > 0.99 ? [1, 0, 0] : [-guess[2], 0, guess[0]])
  const north: Vec3 = [
    guess[1] * east[2] - guess[2] * east[1],
    guess[2] * east[0] - guess[0] * east[2],
    guess[0] * east[1] - guess[1] * east[0],
  ]
  const reach = CELL_ANGLE * 0.5
  const steps = 4
  let best: Vec3 | undefined
  let most = ON_RIVER
  for (let a = -steps; a <= steps; a += 1) {
    for (let b = -steps; b <= steps; b += 1) {
      const da = (a / steps) * reach
      const db = (b / steps) * reach
      const here = unit([
        guess[0] + east[0] * da + north[0] * db,
        guess[1] + east[1] * da + north[1] * db,
        guess[2] + east[2] * da + north[2] * db,
      ])
      const { river } = waterAt(planet, water, here, near)
      if (river > most) {
        most = river
        best = here
      }
    }
  }
  return best
}
