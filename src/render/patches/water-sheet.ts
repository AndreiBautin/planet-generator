import { SEA_RADIUS } from '../water'

/**
 * The water drawn over a patch: the same grid laid at the water's own
 * surface, so it shares the index and meets its neighbours' water. Worked
 * out in the build worker with the rest of the patch: on the page it was
 * 83% of what every arrival cost — two and a half seconds of a ten-second
 * glide — mostly string-keyed maps per vertex.
 */
export interface WaterSheet {
  readonly positions: Float32Array
  readonly normals: Float32Array
  /** How deep the floor lies under the water here: foam where it is nought, lighter water where it is little. */
  readonly depth: Float32Array
  /** And how deep the parent patch would say it is, to slide towards. */
  readonly coarseDepth: Float32Array
  /**
   * Whether the water here is a lake or a river rather than the sea: no
   * swell and no surf on it, and its shallows read by its own depth.
   */
  readonly inland: Float32Array
}

export function waterSheetOf(patch: {
  readonly positions: Float32Array
  readonly coarsePositions: Float32Array
  readonly water: Float32Array
  readonly dry: Float32Array
}): WaterSheet {
  const count = patch.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const coarseDepth = new Float32Array(count)
  const inland = new Float32Array(count)
  const edgeCoarse = new Map<string, number>()
  // The skirt's vertices sit under the edge's, lowered: read as their own
  // depth they made every patch boundary a line of deeper, darker water.
  // A skirt vertex shares its edge vertex's direction, so it takes that
  // vertex's depth.
  const side = Math.round(-2 + Math.sqrt(4 + count))
  const grid = side * side
  const edgeDepth = new Map<string, number>()
  const keyOf = (x: number, y: number, z: number): string => {
    const l = Math.hypot(x, y, z) || 1
    return `${(x / l).toFixed(6)},${(y / l).toFixed(6)},${(z / l).toFixed(6)}`
  }
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = patch.positions[vertex * 3] ?? 0
    const y = patch.positions[vertex * 3 + 1] ?? 0
    const z = patch.positions[vertex * 3 + 2] ?? 1
    const length = Math.hypot(x, y, z) || 1
    // The water's own surface here: the sea, a lake, or a river, and past
    // their shores a sheet held under the dry ground (patch-data.ts).
    const level = patch.water[vertex] ?? 0
    const surface = level > 0 ? level : SEA_RADIUS
    // Settled below for a dry vertex: a level above the sea's is not by
    // itself a lake, since every dry vertex holds its sheet under its
    // own ground.
    inland[vertex] = level > SEA_RADIUS + 1e-6 ? 1 : 0
    const coarse =
      surface -
      Math.hypot(
        patch.coarsePositions[vertex * 4] ?? 0,
        patch.coarsePositions[vertex * 4 + 1] ?? 0,
        patch.coarsePositions[vertex * 4 + 2] ?? 0,
      )
    if (vertex < grid) {
      depth[vertex] = surface - length
      coarseDepth[vertex] = coarse
      edgeDepth.set(keyOf(x, y, z), depth[vertex] ?? 0)
      edgeCoarse.set(keyOf(x, y, z), coarse)
    } else {
      depth[vertex] = edgeDepth.get(keyOf(x, y, z)) ?? surface - length
      coarseDepth[vertex] = edgeCoarse.get(keyOf(x, y, z)) ?? coarse
    }
    normals[vertex * 3] = x / length
    normals[vertex * 3 + 1] = y / length
    normals[vertex * 3 + 2] = z / length
    positions[vertex * 3] = (x / length) * surface
    positions[vertex * 3 + 1] = (y / length) * surface
    positions[vertex * 3 + 2] = (z / length) * surface
  }
  // A dry vertex's sheet is held under its own ground, above the sea's
  // level wherever the ground is, and read as a lake for it: every
  // triangle on a coast then blended sea and lake water, and the
  // shallows stood over the beach in pale, glassy shards. A dry vertex
  // takes its kind from the wet ones beside it instead — a lake's bank
  // is lake, the sea's shore is sea.
  const settled = inland.slice()
  for (let vertex = 0; vertex < grid; vertex += 1) {
    if ((patch.dry[vertex] ?? 0) === 0) continue
    const i = vertex % side
    const j = (vertex - i) / side
    let lake = 0
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= side || nj >= side) continue
        const near = nj * side + ni
        if ((patch.dry[near] ?? 0) === 0) lake = Math.max(lake, inland[near] ?? 0)
      }
    }
    settled[vertex] = lake
  }
  // The skirt follows the edge vertex it hangs from.
  const edgeInland = new Map<string, number>()
  for (let vertex = 0; vertex < count; vertex += 1) {
    const key = keyOf(
      patch.positions[vertex * 3] ?? 0,
      patch.positions[vertex * 3 + 1] ?? 0,
      patch.positions[vertex * 3 + 2] ?? 1,
    )
    if (vertex < grid) edgeInland.set(key, settled[vertex] ?? 0)
    else settled[vertex] = edgeInland.get(key) ?? 0
  }
  inland.set(settled)
  return { positions, normals, depth, coarseDepth, inland }
}
