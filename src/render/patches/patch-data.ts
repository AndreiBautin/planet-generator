import { floorHeightAt, hydrologyOf, waterAt } from '@/generation/hydrology'
import { surfaceAt, type Planet, type Surface } from '@/generation/planet'
import { groupingsAt } from '@/generation/grouping'
import { fbm } from '@/generation/noise'
import { fineReliefAt, reliefWeightAt } from '@/generation/relief'
import { featuresAt, floorAt, FREEZES, patternAt } from '@/generation/features'

import { fromPalette } from '../colour'
import { liftOf } from '../surface-data'
import { SEA_RADIUS } from '../water'
import { directionOn, patchAngle, patchUv, type PatchKey } from './cube'

/**
 * One patch of ground as typed arrays: a grid of (segments + 1)² vertices
 * pushed out by the surface height and painted its colour, then a skirt —
 * one more vertex under every edge vertex, dropped a little towards the
 * centre.
 *
 * The skirt is what hides the cracks. Where a fine patch meets a coarse
 * one, the fine edge has vertices the coarse edge does not, and they rarely
 * sit exactly on its straight line, so a sliver of sky shows between them.
 * Stitching the two would mean every patch knowing its neighbours' levels;
 * a curtain hung under each edge covers the gap without either knowing.
 *
 * Normals come from a ring of samples one step past the edge, so two
 * neighbouring patches light their shared edge the same way and the seam
 * does not show as a crease.
 *
 * The ground drawn carries fine relief on top of the planet's surface (see
 * generation/relief.ts), and steep ground is drawn as bare rock — the two
 * things that make it read as land rather than as a painted ball up close.
 */
export interface PatchData {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colours: Float32Array
  /** Whether any of the patch lies under water — sea, lake or river — so it needs water drawn over it. */
  readonly hasSea: boolean
  /**
   * How far from the centre the water's surface is at each vertex: the sea,
   * a lake's level, or a river running a little below its banks; past the
   * shore, the sheet's height under the dry ground.
   */
  readonly water: Float32Array
  /**
   * How the ground reads close up, four weights a vertex — canopy, sand,
   * snow, stone (see `patternAt`) — which the ground shader draws as tree
   * crowns, wind ripples, carved ridges and cracks.
   */
  readonly pattern: Float32Array
  /**
   * What each vertex would be on the patch one level coarser: the position
   * (with this patch's level in the fourth slot), normal, colour and
   * pattern the parent draws at that point. The ground shader blends
   * towards these as a patch nears the distance where it gives way to its
   * parent, so a change of level is a slow slide rather than a jump.
   */
  readonly coarsePositions: Float32Array
  readonly coarseNormals: Float32Array
  readonly coarseColours: Float32Array
  readonly coarsePattern: Float32Array
  /**
   * How much of the sea here is ice, two a vertex: this patch's and its parent's.
   * The ice is drawn on the water's surface (detail.ts), where it floats:
   * drawn as floor under translucent water, it came and went with the
   * angle the water was seen at.
   */
  readonly ice: Float32Array
  /**
   * How deep the dawn mist lies over each vertex, in radii (valley-fog.ts):
   * from a soft floor of the ground round it up to a set depth, so it pools
   * in the bottoms; just over the water on a lake or a river; below
   * nought — under the ground — where there is none, so its edge feathers
   * across a triangle. A depth rather than a height, because the shader
   * draws the ground blended towards its parent's shape and a height
   * compared with that blend found the mist under the ground.
   */
  readonly mist: Float32Array
  /**
   * How much of a river is white water at each vertex, 0 to 1: where its own
   * surface falls steeply — rapids, and over a cliff a waterfall. Nought on
   * still water and the sea.
   */
  readonly rapids: Float32Array
  /**
   * Which way and how fast a river runs at each vertex, three to a
   * vertex, in the planet's frame: its direction along the ground, as long
   * as it is fast — a slow stretch half, white water two. Nought on still
   * water and the sea.
   */
  readonly current: Float32Array
  /**
   * Each biome's own ground, four weights a vertex — forest needles,
   * savanna, tundra, and salt flat (ash on a molten world) — then the same
   * four as the parent patch has them: eight a vertex. See `groundOf`.
   */
  readonly ground: Float32Array
}

/** Vertices in a patch: the grid, then four edges' worth of skirt. */
/** How far under its own ground a dry vertex holds the water's sheet, so it never shows. */
const DRY = 0.0004
/** How far fine relief lifts the ground, in surface-height units. */
const FINE_RELIEF = 0.2
/** Steepness (one minus the cosine of the slope) where rock starts and where it is all rock. */
const ROCK_FROM = 0.06
const ROCK_FULL = 0.22

/** The height the ground is drawn at, before it is lifted to a radius. */
function drawnHeight(
  planet: Planet,
  x: number,
  y: number,
  z: number,
): {
  readonly surface: ReturnType<typeof surfaceAt>
  readonly fine: number
  readonly drawn: number
} {
  const surface = surfaceAt(planet, x, y, z)
  const fine = fineReliefAt(planet, x, y, z, surface)
  return {
    surface,
    fine,
    drawn: surface.height + fine * reliefWeightAt(planet, surface) * FINE_RELIEF,
  }
}

/**
 * How far from the centre the drawn ground is in a direction, and never
 * below the sea: what something flying low must stay above. The same
 * arithmetic the patches are built with, so the two cannot disagree about
 * where the ground is.
 */
export function groundRadiusAt(
  planet: Planet,
  direction: readonly [number, number, number],
): number {
  const [x, y, z] = direction
  const length = Math.hypot(x, y, z) || 1
  const { drawn } = drawnHeight(planet, x / length, y / length, z / length)
  return Math.max(SEA_RADIUS, 1 + liftOf(drawn, planet.relief))
}

/**
 * The floor under a direction, the sea bed where there is sea: the ground
 * as drawn, without the sea's surface laid over it. What a dive under the
 * water flies over.
 */
export function floorRadiusAt(
  planet: Planet,
  direction: readonly [number, number, number],
): number {
  const [x, y, z] = direction
  const length = Math.hypot(x, y, z) || 1
  const { drawn } = drawnHeight(planet, x / length, y / length, z / length)
  return 1 + liftOf(drawn, planet.relief)
}

/**
 * The same, for a unit direction whose surface is already in hand: the
 * scatter has just sampled it, and sampling it again was a fifth of the
 * cost of a tile of trees.
 */
export function groundRadiusWith(
  planet: Planet,
  x: number,
  y: number,
  z: number,
  surface: Surface,
): number {
  const fine = fineReliefAt(planet, x, y, z, surface)
  const drawn = surface.height + fine * reliefWeightAt(planet, surface) * FINE_RELIEF
  return Math.max(SEA_RADIUS, 1 + liftOf(drawn, planet.relief))
}

export const vertexCount = (segments: number): number => (segments + 1) ** 2 + 4 * (segments + 1)

export function samplePatch(planet: Planet, key: PatchKey, segments: number): PatchData {
  const side = segments + 1
  const ring = segments + 5
  // Positions on a grid two samples wider each way, for the normals — and
  // for the coarser normals the parent patch lights its vertices with.
  const wide = new Float64Array(ring * ring * 3)
  const positions = new Float32Array(vertexCount(segments) * 3)
  const normals = new Float32Array(vertexCount(segments) * 3)
  const colours = new Float32Array(vertexCount(segments) * 3)
  const heights = new Float32Array(side * side)
  const surfaces: Surface[] = []
  const pattern = new Float32Array(vertexCount(segments) * 4)
  const ice = new Float32Array(vertexCount(segments) * 2)
  const mist = new Float32Array(vertexCount(segments))
  const rapids = new Float32Array(vertexCount(segments))
  const current = new Float32Array(vertexCount(segments) * 3)
  const ground = new Float32Array(vertexCount(segments) * 8)
  const water = new Float32Array(vertexCount(segments))
  const wetted = new Float32Array(side * side)
  // Any water's surface radius — sea, lake or river — over the whole ring,
  // borders included, so a shore at a patch's edge is read the same from
  // both sides of it.
  const wet = new Float32Array(ring * ring)
  // The planet's rivers and lakes, made once and shared by every patch
  // (generation/hydrology.ts). A molten world's lowland runs with lava, not water.
  const hydrology = planet.molten ? undefined : hydrologyOf(planet)
  const near = new Map<number, readonly number[]>()
  const nearer = new Map<number, readonly number[]>()
  let hasSea = false

  for (let j = -2; j <= segments + 2; j += 1) {
    for (let i = -2; i <= segments + 2; i += 1) {
      const [u, v] = patchUv(key, i / segments, j / segments)
      const [x, y, z] = directionOn(key.face, u, v)
      const { surface, fine, drawn } = drawnHeight(planet, x, y, z)
      // A river cuts its bed into the ground, and carries water a little
      // below its banks; a lake fills its hollow to the rim.
      let bed = drawn
      let level = Number.NEGATIVE_INFINITY
      let river = 0
      let flow: readonly [number, number, number] = [0, 0, 0]
      if (surface.height < 0) level = 0
      else if (hydrology !== undefined) {
        // Carved wherever the river runs, snow or not; only the water is
        // withheld on snow, where a river lies frozen. Skipped on snow
        // altogether, the bed stopped dead at the snow line, and the uncut
        // snow stood over the cut channel as a white lid on a wall.
        const here = waterAt(planet, hydrology, [x, y, z], near)
        river = here.river
        flow = here.flow
        bed = drawn - here.carve
        if (surface.biome !== 'snow') {
          if (here.river > 0.35) level = drawn - here.carve * 0.45
          if (bed < here.lake) level = Math.max(level, here.lake)
        }
      }
      const radius = 1 + liftOf(bed, planet.relief)
      if (Number.isFinite(level))
        wet[(j + 2) * ring + (i + 2)] =
          surface.height < 0 ? SEA_RADIUS : Math.max(SEA_RADIUS, 1 + liftOf(level, planet.relief))
      const at = ((j + 2) * ring + (i + 2)) * 3
      wide[at] = x * radius
      wide[at + 1] = y * radius
      wide[at + 2] = z * radius
      if (i < 0 || j < 0 || i > segments || j > segments) continue
      if (hydrology !== undefined) {
        // Mist fills a valley from its floor up to a level, flat on top, so
        // it pools in the bottoms and the slopes rise out of it. The floor
        // is the ground's mean round about, less its spread; the level
        // stands a set depth over it.
        const floor =
          1 + liftOf(floorHeightAt(hydrology, [x, y, z], nearer, MIST_SPREAD), planet.relief)
        // Not levelled over a lake's shores: the level a lake holds nearby
        // comes off the drainage map's cells, and mist laid flat to it drew
        // their square edges across the land.
        const pool = Math.max(floor + MIST_DEPTH, SEA_RADIUS + MIST_COAST)
        const depth = pool - radius
        let deep = surface.height < 0 ? -MIST_COAST : depth
        // Over a lake or a river the mist lies on the water, whatever the
        // land round it does: water is where it forms first.
        if (Number.isFinite(level) && surface.height >= 0)
          deep = Math.max(deep, 1 + liftOf(level, planet.relief) + MIST_ON_WATER - radius)
        mist[j * side + i] = deep
      }
      if (Number.isFinite(level)) {
        hasSea = true
        water[j * side + i] =
          surface.height < 0 ? SEA_RADIUS : Math.max(SEA_RADIUS, 1 + liftOf(level, planet.relief))
      }
      wetted[j * side + i] = river
      if (river > 0.2 && Number.isFinite(level) && surface.height >= 0) {
        const w = Math.min(1, river)
        current.set([flow[0] * w, flow[1] * w, flow[2] * w], (j * side + i) * 3)
      }
      const out = (j * side + i) * 3
      positions[out] = x * radius
      positions[out + 1] = y * radius
      positions[out + 2] = z * radius
      heights[j * side + i] = surface.height
      // How much of the sea here is ice, by the rule the floes are placed
      // by (features.ts): solid pack below freezing, thinning to open water
      // just above it.
      // Under the land too, where the sheet is hidden: an icy shore read as
      // no ice on its dry vertices, and a strip of open water followed the
      // grid's triangles round every frozen coast, a staircase from orbit.
      ice[(j * side + i) * 2] = planet.molten
        ? 0
        : Math.min(1, Math.max(0, (FREEZES + 0.2 - surface.warmth) / 0.2))
      surfaces[j * side + i] = surface
      // Light and shade from the same fine noise, and a mottle at field
      // scale — patches of lusher and drier, lighter and darker ground —
      // so a plain of one biome is never one flat colour.
      const linear = fromPalette(surface.colour)
      if (surface.height > 0 && surface.biome !== 'snow') {
        const [ox, oy, oz] = planet.offset
        const field = fbm(planet.fine, (x + oz) * 30, (y + ox) * 30, (z + oy) * 30, 3)
        const broad = fbm(planet.fine, (x - ox) * 8, (y - oy) * 8, (z - oz) * 8, 2)
        const shade = (0.9 + fine * 0.15) * (1 + field * 0.14 + broad * 0.1)
        // Warmer and a little yellower where it is drier, cooler where lusher.
        const dry = broad * 0.5 + field * 0.3
        colours[out] = linear.r * shade * (1 + dry * 0.1)
        colours[out + 1] = linear.g * shade
        colours[out + 2] = linear.b * shade * (1 - dry * 0.12)
      } else {
        const shade = surface.height > 0 ? 0.95 + fine * 0.08 : 1
        colours[out] = linear.r * shade
        colours[out + 1] = linear.g * shade
        colours[out + 2] = linear.b * shade
      }
    }
  }

  // White water where a river's own surface falls steeply: the slope of
  // the water level across a vertex, from the ring of levels round it, in
  // radii per radian. Only on rivers (lakes are level, and the sea), and
  // only between water and water, so a bank does not read as a fall: on
  // whichever side has water, one-sided where only one does, because a
  // river is often a single vertex wide and has a bank on both sides.
  const step = patchAngle(key.level) / segments
  const across = (here: number, ahead: number, behind: number): number => {
    if (ahead > 0 && behind > 0) return (ahead - behind) / (2 * step)
    if (ahead > 0) return (ahead - here) / step
    if (behind > 0) return (here - behind) / step
    return 0
  }
  for (let j = 0; j <= segments; j += 1) {
    for (let i = 0; i <= segments; i += 1) {
      const v = j * side + i
      const river = wetted[v] ?? 0
      const at = (j + 2) * ring + (i + 2)
      const here = wet[at] ?? 0
      if (river < 0.2 || here <= 0) continue
      const slope = Math.hypot(
        across(here, wet[at + 1] ?? 0, wet[at - 1] ?? 0),
        across(here, wet[at + ring] ?? 0, wet[at - ring] ?? 0),
      )
      rapids[v] = Math.min(1, river) * smoothRange(RAPIDS_FROM, RAPIDS_FULL, slope)
      // White water runs fast.
      const fast = 0.5 + 1.5 * (rapids[v] ?? 0)
      for (let c = 0; c < 3; c += 1) current[v * 3 + c] = (current[v * 3 + c] ?? 0) * fast
    }
  }

  // The water's surface runs on one vertex past any shore, level, under
  // the bank: the sheet then meets the ground where the two cross. Left to
  // follow the ground there it climbed the bank and stood out of it as a
  // jagged wall. Never above the vertex's own ground: between a high lake
  // and a lower river, the higher level would stand water on dry land.
  // Further in, every dry vertex keeps the sheet just under its own ground
  // (`DRY` below). At sea level, as it once was everywhere, a lake on a
  // plateau dropped its sheet a long way down to the sea's height, and
  // where the hill fell away faster than the sheet it stood out of the
  // hillside as blue walls under a white lid of mirrored sky.
  for (let j = 0; j <= segments; j += 1) {
    for (let i = 0; i <= segments; i += 1) {
      const vertex = j * side + i
      if ((water[vertex] ?? 0) > 0) continue
      let spill = 0
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          spill = Math.max(spill, wet[(j + 2 + dj) * ring + (i + 2 + di)] ?? 0)
        }
      }
      const ground = Math.hypot(
        positions[vertex * 3] ?? 0,
        positions[vertex * 3 + 1] ?? 0,
        positions[vertex * 3 + 2] ?? 0,
      )
      water[vertex] = spill > 0 ? Math.min(spill, ground - DRY) : ground - DRY
    }
  }

  const stone = fromPalette(planet.palette.highland).lerp(fromPalette(planet.palette.peak), 0.25)
  const sample = (i: number, j: number, axis: number): number =>
    wide[((j + 2) * ring + (i + 2)) * 3 + axis] ?? 0
  for (let j = 0; j <= segments; j += 1) {
    for (let i = 0; i <= segments; i += 1) {
      // Central differences along u and v; u × v points outwards by
      // construction of the face frames.
      const ax = sample(i + 1, j, 0) - sample(i - 1, j, 0)
      const ay = sample(i + 1, j, 1) - sample(i - 1, j, 1)
      const az = sample(i + 1, j, 2) - sample(i - 1, j, 2)
      const bx = sample(i, j + 1, 0) - sample(i, j - 1, 0)
      const by = sample(i, j + 1, 1) - sample(i, j - 1, 1)
      const bz = sample(i, j + 1, 2) - sample(i, j - 1, 2)
      const nx = ay * bz - az * by
      const ny = az * bx - ax * bz
      const nz = ax * by - ay * bx
      const length = Math.hypot(nx, ny, nz) || 1
      const out = (j * side + i) * 3
      normals[out] = nx / length
      normals[out + 1] = ny / length
      normals[out + 2] = nz / length

      // Bare rock where the land is steep: grass and sand do not hold to a
      // cliff, and a slope the same colour as the plain beneath it reads as
      // a painted bump rather than a hillside.
      const height = heights[j * side + i] ?? 0
      const px = positions[out] ?? 0
      const py = positions[out + 1] ?? 0
      const pz = positions[out + 2] ?? 0
      const radial = Math.hypot(px, py, pz) || 1
      // A river's banks are cut steeper than any hillside, and read as rock
      // if left to the slope: a river runs between grassy banks, so the
      // ground beside one is judged as though it were level.
      const steep =
        (1 - (nx * px + ny * py + nz * pz) / length / radial) *
        (1 - Math.min(1, (wetted[j * side + i] ?? 0) * 8))
      const here = surfaces[j * side + i]
      if (here !== undefined) {
        const look = patternAt(planet, here, steep)
        const at = (j * side + i) * 4
        // The painted canopy follows the groves the trees stand in, and
        // the ground turns stony where the rock lies, so the ground and
        // what stands on it agree about where a wood or an outcrop is.
        const grouping = groupingsAt(planet, px / radial, py / radial, pz / radial)
        const stony = Math.min(1, floorAt(planet, here, steep).rock * 2) * grouping.outcrop
        // No wood under water: a lake fills its hollow over whatever grew
        // there, and the trees stood up through it.
        const drowned = (water[j * side + i] ?? 0) > radial
        pattern[at] = drowned ? 0 : look.canopy * Math.min(1, grouping.grove * 1.4)
        pattern[at + 1] = look.sand * (1 - stony * 0.7)
        pattern[at + 2] = look.snow
        pattern[at + 3] = Math.min(1, look.stone + stony * 0.8)
        const kinds = groundOf(planet, here, steep, look)
        for (let k = 0; k < 4; k += 1) ground[(j * side + i) * 8 + k] = kinds[k] ?? 0
        if (stony > 0 && height > 0) {
          const k = stony * 0.55
          colours[out] = mix(colours[out] ?? 0, stone.r, k)
          colours[out + 1] = mix(colours[out + 1] ?? 0, stone.g, k)
          colours[out + 2] = mix(colours[out + 2] ?? 0, stone.b, k)
        }
      }
      if (height > 0.03) {
        // Snow lets go of rock at a gentler slope than turf does: a wind-
        // scoured ridge on a snowfield shows its stone, which is the only
        // thing that draws the shape of a white landscape.
        const snowy = here?.biome === 'snow'
        const from = snowy ? 0.03 : ROCK_FROM
        const full = snowy ? 0.12 : ROCK_FULL
        const rock = Math.min(1, Math.max(0, (steep - from) / (full - from))) * (snowy ? 0.85 : 1)
        if (rock > 0) {
          colours[out] = mix(colours[out] ?? 0, stone.r, rock)
          colours[out + 1] = mix(colours[out + 1] ?? 0, stone.g, rock)
          colours[out + 2] = mix(colours[out + 2] ?? 0, stone.b, rock)
        }
      }
    }
  }

  // How much sky each point sees: in eight directions, how far the ground
  // two steps out rises above it. A valley floor sees less sky and a ridge
  // more, so the land is shaded by its own shape at every distance — baked
  // here with the colour, so it slides between levels as the colour does
  // and can never pop. Two steps is as far as the ring of samples reaches,
  // which is also what keeps a shared edge the same from both patches.
  const directions = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ] as const
  for (let j = 0; j <= segments; j += 1) {
    for (let i = 0; i <= segments; i += 1) {
      const cx = sample(i, j, 0)
      const cy = sample(i, j, 1)
      const cz = sample(i, j, 2)
      const radial = Math.hypot(cx, cy, cz) || 1
      let rise = 0
      for (const [di, dj] of directions) {
        let horizon = -1
        for (let step = 1; step <= 2; step += 1) {
          const dx = sample(i + di * step, j + dj * step, 0) - cx
          const dy = sample(i + di * step, j + dj * step, 1) - cy
          const dz = sample(i + di * step, j + dj * step, 2) - cz
          const reach = Math.hypot(dx, dy, dz) || 1
          horizon = Math.max(horizon, (dx * cx + dy * cy + dz * cz) / radial / reach)
        }
        rise += horizon
      }
      // Rise is the mean sine of the horizon: above nought the ground is
      // cupped and sees less sky, below it the ground falls away.
      const cupped = rise / directions.length
      // A river's bed and banks are darker for being wet.
      const sky =
        Math.min(1.08, Math.max(0.5, 1 - cupped * 2.2)) * (1 - (wetted[j * side + i] ?? 0) * 0.3)
      const out = (j * side + i) * 3
      colours[out] = (colours[out] ?? 0) * sky
      colours[out + 1] = (colours[out + 1] ?? 0) * sky
      colours[out + 2] = (colours[out + 2] ?? 0) * sky
    }
  }

  // The parent's view of each vertex. Every other vertex is one the parent
  // has too; the rest lie on the parent's grid lines or across its
  // triangles' shared diagonal (b to c in `patchIndex`), where the parent
  // draws the average of the two ends.
  const count = vertexCount(segments)
  const coarsePositions = new Float32Array(count * 4)
  const coarseNormals = new Float32Array(count * 3)
  const coarseColours = new Float32Array(count * 3)
  const coarsePattern = new Float32Array(count * 4)
  const parentNormal = (i: number, j: number): readonly [number, number, number] => {
    // Central differences two steps wide: the parent's own spacing.
    const ax = sample(i + 2, j, 0) - sample(i - 2, j, 0)
    const ay = sample(i + 2, j, 1) - sample(i - 2, j, 1)
    const az = sample(i + 2, j, 2) - sample(i - 2, j, 2)
    const bx = sample(i, j + 2, 0) - sample(i, j - 2, 0)
    const by = sample(i, j + 2, 1) - sample(i, j - 2, 1)
    const bz = sample(i, j + 2, 2) - sample(i, j - 2, 2)
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
  }
  for (let j = 0; j <= segments; j += 1) {
    for (let i = 0; i <= segments; i += 1) {
      const oddI = i % 2 === 1
      const oddJ = j % 2 === 1
      const ends: readonly (readonly [number, number])[] =
        oddI && oddJ
          ? [
              [i + 1, j - 1],
              [i - 1, j + 1],
            ]
          : oddI
            ? [
                [i - 1, j],
                [i + 1, j],
              ]
            : oddJ
              ? [
                  [i, j - 1],
                  [i, j + 1],
                ]
              : [[i, j]]
      const vertex = j * side + i
      let nx = 0
      let ny = 0
      let nz = 0
      for (const [ei, ej] of ends) {
        const from = ej * side + ei
        const share = 1 / ends.length
        for (let axis = 0; axis < 3; axis += 1) {
          coarsePositions[vertex * 4 + axis] =
            (coarsePositions[vertex * 4 + axis] ?? 0) + (positions[from * 3 + axis] ?? 0) * share
          coarseColours[vertex * 3 + axis] =
            (coarseColours[vertex * 3 + axis] ?? 0) + (colours[from * 3 + axis] ?? 0) * share
        }
        for (let k = 0; k < 4; k += 1) {
          coarsePattern[vertex * 4 + k] =
            (coarsePattern[vertex * 4 + k] ?? 0) + (pattern[from * 4 + k] ?? 0) * share
        }
        ice[vertex * 2 + 1] = (ice[vertex * 2 + 1] ?? 0) + (ice[from * 2] ?? 0) * share
        for (let k = 0; k < 4; k += 1) {
          ground[vertex * 8 + 4 + k] =
            (ground[vertex * 8 + 4 + k] ?? 0) + (ground[from * 8 + k] ?? 0) * share
        }
        const [px, py, pz] = parentNormal(ei, ej)
        const length = Math.hypot(px, py, pz) || 1
        nx += px / length
        ny += py / length
        nz += pz / length
      }
      const length = Math.hypot(nx, ny, nz) || 1
      coarseNormals[vertex * 3] = nx / length
      coarseNormals[vertex * 3 + 1] = ny / length
      coarseNormals[vertex * 3 + 2] = nz / length
      coarsePositions[vertex * 4 + 3] = key.level
    }
  }

  // The skirt: a copy of each edge vertex, lowered by about a grid step —
  // deeper than any crack a level boundary opens, and shallow enough that
  // it never shows below a hill seen side-on.
  const drop = 1 - Math.max(0.0015, (patchAngle(key.level) / segments) * 1.5)
  let skirt = side * side
  for (const edge of edgeOrder(segments)) {
    for (const vertex of edge) {
      for (let axis = 0; axis < 3; axis += 1) {
        positions[skirt * 3 + axis] = (positions[vertex * 3 + axis] ?? 0) * drop
        normals[skirt * 3 + axis] = normals[vertex * 3 + axis] ?? 0
        colours[skirt * 3 + axis] = colours[vertex * 3 + axis] ?? 0
      }
      for (let k = 0; k < 4; k += 1) pattern[skirt * 4 + k] = pattern[vertex * 4 + k] ?? 0
      for (let axis = 0; axis < 3; axis += 1) {
        coarsePositions[skirt * 4 + axis] = (coarsePositions[vertex * 4 + axis] ?? 0) * drop
        coarseNormals[skirt * 3 + axis] = coarseNormals[vertex * 3 + axis] ?? 0
        coarseColours[skirt * 3 + axis] = coarseColours[vertex * 3 + axis] ?? 0
      }
      coarsePositions[skirt * 4 + 3] = key.level
      for (let k = 0; k < 4; k += 1)
        coarsePattern[skirt * 4 + k] = coarsePattern[vertex * 4 + k] ?? 0
      water[skirt] = water[vertex] ?? 0
      mist[skirt] = mist[vertex] ?? 0
      rapids[skirt] = rapids[vertex] ?? 0
      current[skirt * 3] = current[vertex * 3] ?? 0
      current[skirt * 3 + 1] = current[vertex * 3 + 1] ?? 0
      current[skirt * 3 + 2] = current[vertex * 3 + 2] ?? 0
      ice[skirt * 2] = ice[vertex * 2] ?? 0
      ice[skirt * 2 + 1] = ice[vertex * 2 + 1] ?? 0
      for (let k = 0; k < 8; k += 1) ground[skirt * 8 + k] = ground[vertex * 8 + k] ?? 0
      skirt += 1
    }
  }

  return {
    positions,
    normals,
    colours,
    hasSea,
    pattern,
    coarsePositions,
    coarseNormals,
    coarseColours,
    coarsePattern,
    ice,
    mist,
    rapids,
    current,
    ground,
    water,
  }
}

/** How deep dawn mist stands over the floor of the ground round it, in radii. */
const MIST_DEPTH = 0.0027
/** How far under the ground's mean round about that floor sits, in its standard deviations. */
const MIST_SPREAD = 1
/** Mist stands at least this high over the sea along a coast. */
const MIST_COAST = 0.0012
/** How deep it lies over a lake or a river. */
const MIST_ON_WATER = 0.0009

const mix = (from: number, to: number, t: number): number => from + (to - from) * t

/** A river's slope, in radii per radian, where white water begins and where it is all white. */
const RAPIDS_FROM = 0.15
const RAPIDS_FULL = 0.45

const smoothRange = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** The grid vertices along each edge, in order: bottom, top, left, right. */
function edgeOrder(segments: number): readonly (readonly number[])[] {
  const side = segments + 1
  const along = Array.from({ length: side }, (_, k) => k)
  return [
    along.map((i) => i),
    along.map((i) => segments * side + i),
    along.map((j) => j * side),
    along.map((j) => j * side + segments),
  ]
}

const indices = new Map<number, Uint16Array>()

/**
 * The triangles of a patch, which are the same for every patch with the
 * same number of segments — so one index buffer is shared by all of them.
 * Skirt quads are wound both ways, because a skirt is seen from either side
 * depending on which neighbour is the finer.
 */
export function patchIndex(segments: number): Uint16Array {
  const cached = indices.get(segments)
  if (cached !== undefined) return cached
  const side = segments + 1
  const out: number[] = []
  for (let j = 0; j < segments; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = j * side + i
      const b = a + 1
      const c = a + side
      const d = c + 1
      out.push(a, b, c, b, d, c)
    }
  }
  let skirt = side * side
  for (const edge of edgeOrder(segments)) {
    for (let k = 0; k < segments; k += 1) {
      const e0 = edge[k] ?? 0
      const e1 = edge[k + 1] ?? 0
      const s0 = skirt + k
      const s1 = skirt + k + 1
      out.push(e0, e1, s0, e1, s1, s0)
      out.push(e0, s0, e1, e1, s0, s1)
    }
    skirt += side
  }
  const index = Uint16Array.from(out)
  indices.set(segments, index)
  return index
}

const quarters = new Map<string, Uint16Array>()

/**
 * The triangles of one quarter of a patch — the quarter its child `quarter`
 * (0 to 3, in `childrenOf` order) covers — with the skirt along the patch's
 * own edges there. A patch can then stand in for one missing child alone,
 * rather than for all four: drawn whole, one child not yet built hid three
 * that were, and the ground went coarse far beyond the gap.
 */
export function quarterIndex(segments: number, quarter: number): Uint16Array {
  const name = `${String(segments)}:${String(quarter)}`
  const cached = quarters.get(name)
  if (cached !== undefined) return cached
  const side = segments + 1
  const half = segments / 2
  const dx = quarter % 2
  const dy = Math.floor(quarter / 2)
  const i0 = dx * half
  const j0 = dy * half
  const out: number[] = []
  for (let j = j0; j < j0 + half; j += 1) {
    for (let i = i0; i < i0 + half; i += 1) {
      const a = j * side + i
      const b = a + 1
      const c = a + side
      const d = c + 1
      out.push(a, b, c, b, d, c)
    }
  }
  // The skirt along whichever of the patch's own edges this quarter touches:
  // bottom, top, left, right, in `edgeOrder`'s order.
  const touches = [dy === 0, dy === 1, dx === 0, dx === 1]
  const from = [i0, i0, j0, j0]
  let skirt = side * side
  edgeOrder(segments).forEach((edge, e) => {
    if (touches[e] === true) {
      const start = from[e] ?? 0
      for (let k = start; k < start + half; k += 1) {
        const e0 = edge[k] ?? 0
        const e1 = edge[k + 1] ?? 0
        const s0 = skirt + k
        const s1 = skirt + k + 1
        out.push(e0, e1, s0, e1, s1, s0)
        out.push(e0, s0, e1, e1, s0, s1)
      }
    }
    skirt += side
  })
  const index = Uint16Array.from(out)
  quarters.set(name, index)
  return index
}

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * Which of the biome grounds a point wears, each 0 to 1: forest needles
 * where the woods are conifer, savanna where it is warm and dry, tundra
 * where it is cold but not yet snow, and a salt flat on the driest low
 * ground — or, on a molten world, ash wherever the lava is not.
 */
export function groundOf(
  planet: Planet,
  surface: Surface,
  steep: number,
  look: {
    readonly canopy: number
    readonly sand: number
    readonly snow: number
    readonly stone: number
  },
): readonly [number, number, number, number] {
  if (surface.height <= 0) return [0, 0, 0, 0]
  if (planet.molten)
    return [0, 0, 0, Math.max(0, 0.75 - look.sand) * (1 - smooth(0.06, 0.2, steep))]
  const growth = featuresAt(planet, surface, steep)
  const trees = growth.broadleaf + growth.conifer
  const needles = trees > 0 ? look.canopy * (growth.conifer / trees) : 0
  const open = (1 - look.sand) * (1 - look.stone) * (1 - look.snow)
  const savanna =
    open * smooth(0.15, 0.45, surface.warmth) * (1 - smooth(0.3, 0.55, surface.moisture))
  const tundra = open * (1 - smooth(-0.25, 0.02, surface.warmth))
  const salt =
    (1 - smooth(0.1, 0.28, surface.moisture)) *
    (1 - smooth(0.02, 0.14, surface.height)) *
    (1 - smooth(0.04, 0.12, steep))
  return [needles, savanna * (1 - needles), tundra * (1 - needles), salt]
}
