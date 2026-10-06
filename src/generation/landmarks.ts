import type { Vec3 } from './cube'
import { cellCentre, hydrologyOf, neighboursOf, RIVER_FLOW } from './hydrology'
import { placeName } from './name'
import { surfaceAt, type Planet } from './planet'
import { createRng } from './rng'

/**
 * A planet's sights, found from its ground and its water and named from
 * its seed: the highest peak, the largest lake, the longest river. What a
 * guided tour visits, in the order it chooses.
 *
 * Found on the drainage map's grid (hydrology.ts), so a lake is the lake
 * the ground draws and a river runs where the water does.
 */
export type LandmarkKind = 'peak' | 'lake' | 'river'

export interface Landmark {
  readonly kind: LandmarkKind
  /** What it is called: "Mount Kaeror", "Lake Vithon", "the Drazu". */
  readonly name: string
  /** What it is: "The highest point on Quorthekru". */
  readonly title: string
  /** Where it is, as a unit direction. */
  readonly at: Vec3
  /** For a river, its course from source to sea, a direction a cell; one point otherwise. */
  readonly path: readonly Vec3[]
}

export function landmarksOf(planet: Planet): readonly Landmark[] {
  const water = hydrologyOf(planet)
  const naming = createRng(planet.seed).fork('landmarks')
  const found: Landmark[] = []
  const { height, lake, flow, receiver } = water

  // The highest ground.
  let peak = -1
  for (let cell = 0; cell < height.length; cell += 1) {
    if (peak < 0 || (height[cell] ?? 0) > (height[peak] ?? 0)) peak = cell
  }
  if (peak >= 0 && (height[peak] ?? 0) > 0) {
    const at = cellCentre(peak)
    found.push({
      kind: 'peak',
      name: `Mount ${placeName(naming.fork('peak'))}`,
      title: planet.molten
        ? `The highest fire on ${planet.name}`
        : `The highest point on ${planet.name}`,
      at,
      path: [at],
    })
  }

  if (!planet.molten) {
    // Water is drawn only where it is not snow (patch-data.ts): a lake or a
    // river under snow is a dip in a snowfield, and naming it on a tour
    // points at nothing anybody can see.
    const thawed = new Uint8Array(height.length)
    for (let cell = 0; cell < height.length; cell += 1) {
      const [x, y, z] = cellCentre(cell)
      thawed[cell] = surfaceAt(planet, x, y, z).biome === 'snow' ? 0 : 1
    }
    // The largest lake: lake cells joined to their neighbours.
    const isLake = (c: number): boolean =>
      thawed[c] === 1 && Number.isFinite(lake[c] ?? Number.NEGATIVE_INFINITY)
    const seen = new Uint8Array(height.length)
    let biggest: number[] = []
    for (let cell = 0; cell < height.length; cell += 1) {
      if (seen[cell] === 1 || !isLake(cell)) continue
      const group: number[] = []
      const stack = [cell]
      seen[cell] = 1
      while (stack.length > 0) {
        const at = stack.pop() ?? 0
        group.push(at)
        for (const next of neighboursOf(at)) {
          if (seen[next] === 1 || !isLake(next)) continue
          seen[next] = 1
          stack.push(next)
        }
      }
      if (group.length > biggest.length) biggest = group
    }
    if (biggest.length >= 3) {
      // Its middle: the cell nearest the lake's centre, so the tour arrives over water.
      const mean = biggest.reduce<[number, number, number]>(
        (sum, c) => {
          const [x, y, z] = cellCentre(c)
          return [sum[0] + x, sum[1] + y, sum[2] + z]
        },
        [0, 0, 0],
      )
      const ml = Math.hypot(...mean) || 1
      const centre: Vec3 = [mean[0] / ml, mean[1] / ml, mean[2] / ml]
      let middle = biggest[0] ?? 0
      let nearest = -2
      for (const c of biggest) {
        const [x, y, z] = cellCentre(c)
        const d = x * centre[0] + y * centre[1] + z * centre[2]
        if (d > nearest) {
          nearest = d
          middle = c
        }
      }
      const at = cellCentre(middle)
      found.push({
        kind: 'lake',
        name: `Lake ${placeName(naming.fork('lake'))}`,
        title: `The largest lake on ${planet.name}`,
        at,
        path: [at],
      })
    }

    // The longest river: the longest run of river cells from a source down to the sea.
    const isRiver = (c: number): boolean =>
      thawed[c] === 1 &&
      (flow[c] ?? 0) >= RIVER_FLOW &&
      (height[c] ?? 0) > 0 &&
      (receiver[c] ?? -1) >= 0
    // A source is a river cell no other river cell drains into.
    const fed = new Uint8Array(height.length)
    for (let cell = 0; cell < height.length; cell += 1) {
      if (isRiver(cell)) fed[receiver[cell] ?? 0] = 1
    }
    let longest: number[] = []
    for (let cell = 0; cell < height.length; cell += 1) {
      if (!isRiver(cell) || fed[cell] === 1) continue
      const course: number[] = []
      for (let at = cell; at >= 0 && isRiver(at) && course.length < 4000; at = receiver[at] ?? -1) {
        course.push(at)
      }
      if (course.length > longest.length) longest = course
    }
    if (longest.length >= 6) {
      const path = longest.map((c) => cellCentre(c))
      found.push({
        kind: 'river',
        name: `the ${placeName(naming.fork('river'))}`,
        title: `The longest river on ${planet.name}`,
        at: path[Math.floor(path.length / 2)] ?? path[0] ?? [0, 0, 1],
        path,
      })
    }
  }
  return found
}

/** The landmarks in the order a tour from `from` visits them: always the nearest one not yet seen. */
export function tourOrder(landmarks: readonly Landmark[], from: Vec3): readonly Landmark[] {
  const left = [...landmarks]
  const order: Landmark[] = []
  let here = from
  while (left.length > 0) {
    let best = 0
    let bestDot = -2
    left.forEach((landmark, k) => {
      const start = landmark.path[0] ?? landmark.at
      const d = here[0] * start[0] + here[1] * start[1] + here[2] * start[2]
      if (d > bestDot) {
        bestDot = d
        best = k
      }
    })
    const [next] = left.splice(best, 1)
    if (next === undefined) break
    order.push(next)
    here = next.path[next.path.length - 1] ?? next.at
  }
  return order
}
