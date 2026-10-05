import { surfaceAt, type Planet } from '@/generation/planet'
import { fineReliefAt, fineReliefWeight } from '@/generation/relief'

import { fromPalette } from '../colour'
import { liftOf } from '../surface-data'
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
  /** Whether any of the patch lies under the sea, so it needs water drawn over it. */
  readonly hasSea: boolean
}

/** Vertices in a patch: the grid, then four edges' worth of skirt. */
/** How far fine relief lifts the ground, in surface-height units. */
const FINE_RELIEF = 0.11
/** Steepness (one minus the cosine of the slope) where rock starts and where it is all rock. */
const ROCK_FROM = 0.06
const ROCK_FULL = 0.22

export const vertexCount = (segments: number): number => (segments + 1) ** 2 + 4 * (segments + 1)

export function samplePatch(planet: Planet, key: PatchKey, segments: number): PatchData {
  const side = segments + 1
  const ring = segments + 3
  // Positions on a grid one sample wider each way, for the normals.
  const wide = new Float64Array(ring * ring * 3)
  const positions = new Float32Array(vertexCount(segments) * 3)
  const normals = new Float32Array(vertexCount(segments) * 3)
  const colours = new Float32Array(vertexCount(segments) * 3)
  const heights = new Float32Array(side * side)
  let hasSea = false

  for (let j = -1; j <= segments + 1; j += 1) {
    for (let i = -1; i <= segments + 1; i += 1) {
      const [u, v] = patchUv(key, i / segments, j / segments)
      const [x, y, z] = directionOn(key.face, u, v)
      const surface = surfaceAt(planet, x, y, z)
      const fine = fineReliefAt(planet, x, y, z)
      const drawn = surface.height + fine * fineReliefWeight(surface.height) * FINE_RELIEF
      const radius = 1 + liftOf(drawn, planet.relief)
      const at = ((j + 1) * ring + (i + 1)) * 3
      wide[at] = x * radius
      wide[at + 1] = y * radius
      wide[at + 2] = z * radius
      if (i < 0 || j < 0 || i > segments || j > segments) continue
      if (surface.height < 0) hasSea = true
      const out = (j * side + i) * 3
      positions[out] = x * radius
      positions[out + 1] = y * radius
      positions[out + 2] = z * radius
      heights[j * side + i] = surface.height
      // A little light and shade from the same fine noise, so a plain of
      // one biome is not one flat colour.
      const shade = surface.height > 0 ? 0.9 + fine * 0.15 : 1
      const linear = fromPalette(surface.colour)
      colours[out] = linear.r * shade
      colours[out + 1] = linear.g * shade
      colours[out + 2] = linear.b * shade
    }
  }

  const stone = fromPalette(planet.palette.highland).lerp(fromPalette(planet.palette.peak), 0.25)
  const sample = (i: number, j: number, axis: number): number =>
    wide[((j + 1) * ring + (i + 1)) * 3 + axis] ?? 0
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
      if (height > 0.03) {
        const px = positions[out] ?? 0
        const py = positions[out + 1] ?? 0
        const pz = positions[out + 2] ?? 0
        const radial = Math.hypot(px, py, pz) || 1
        const upright = (nx * px + ny * py + nz * pz) / length / radial
        const steep = 1 - upright
        const rock = Math.min(1, Math.max(0, (steep - ROCK_FROM) / (ROCK_FULL - ROCK_FROM)))
        if (rock > 0) {
          colours[out] = mix(colours[out] ?? 0, stone.r, rock)
          colours[out + 1] = mix(colours[out + 1] ?? 0, stone.g, rock)
          colours[out + 2] = mix(colours[out + 2] ?? 0, stone.b, rock)
        }
      }
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
      skirt += 1
    }
  }

  return { positions, normals, colours, hasSea }
}

const mix = (from: number, to: number, t: number): number => from + (to - from) * t

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
