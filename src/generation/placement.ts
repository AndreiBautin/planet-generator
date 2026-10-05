import { directionOn, type Face, type Vec3 } from './cube'
import { FEATURES, featuresAt, floorAt, NOTHING, type Feature, type Growth } from './features'
import { groundRadiusAt } from './ground'
import { groupingsAt } from './grouping'
import { surfaceAt, type Planet, type Surface } from './planet'
import { hashSeed } from './rng'

/**
 * Where the features stand: the grid, the hash, and the choice of what is
 * in each cell. The renderer's scatterer turns a placement into an instance
 * with a size and a colour; the voxel world turns it into block trees and
 * stone. Both ask here, so a tree the flyover showed is the tree you walk
 * up to.
 *
 * A grid is laid over each face of the cube at a fixed spacing (`CELL`,
 * in face coordinates), and each cell's features are decided by a hash of
 * the cell, so a feature is the same one whatever patch or landing carries
 * it. Every cell can hold two things — one standing (`featuresAt`) and one
 * on the floor (`floorAt`) — each at its own jittered spot.
 */
export const CELL = 0.0009

/** Hash a cell to a number in [0, 1), from a seed word, the cell and a salt. */
export function cellHash(
  seedWord: number,
  face: number,
  i: number,
  j: number,
  salt: number,
): number {
  let h = seedWord ^ Math.imul(face + 1, 0x9e3779b1)
  h = Math.imul(h ^ i, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ j, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16) ^ salt, 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** The seed word every feature placement on a planet hashes from. */
export const featureWord = (planet: Planet): number => hashSeed(`${planet.seed}/features`)[0]

type Grouping = 'grove' | 'outcrop' | 'pavement' | 'none'

/** How each kind groups: the noise its density follows. */
const GROUPING: Readonly<Record<Feature, Grouping>> = {
  broadleaf: 'grove',
  conifer: 'grove',
  shrub: 'grove',
  grass: 'grove',
  cactus: 'outcrop',
  rock: 'outcrop',
  boulder: 'outcrop',
  spire: 'pavement',
  cone: 'none',
  floe: 'none',
}

interface Groupings {
  readonly grove: number
  readonly outcrop: number
  readonly pavement: number
  readonly none: number
}

/** Pick one feature from a layer by a roll, each weighted by its grouping. */
function pick(growth: Growth, groups: Groupings, roll: number): Feature | undefined {
  let under = 0
  for (const candidate of FEATURES) {
    const chance = growth[candidate]
    if (chance === 0) continue
    under += chance * groups[GROUPING[candidate]]
    if (roll < under) return candidate
  }
  return undefined
}

export interface Placement {
  /** A stable name — face, cell and slot — so a felled tree can be left out of the glide. */
  readonly id: string
  readonly feature: Feature
  /** Unit direction from the centre. */
  readonly direction: Vec3
  /** The radius of the ground there, never below the sea. */
  readonly ground: number
  readonly surface: Surface
  /** Three rolls in [0, 1) for the size, the shade and the turn. */
  readonly rolls: readonly [number, number, number]
  /** Standing (a tree, a boulder) or on the floor (scrub, loose rock). */
  readonly standing: boolean
}

/** What stands in one cell of a face's grid: nothing, one thing, or two. */
export function placementsIn(
  planet: Planet,
  face: Face,
  i: number,
  j: number,
  word: number = featureWord(planet),
): Placement[] {
  const u = (i + 0.1 + cellHash(word, face, i, j, 1) * 0.8) * CELL
  const v = (j + 0.1 + cellHash(word, face, i, j, 2) * 0.8) * CELL
  const direction = directionOn(face, u, v)
  const [x, y, z] = direction
  const surface = surfaceAt(planet, x, y, z)
  const atSea = surface.height < 0
  // Open water carries nothing: skip the slope sampling there.
  if (atSea && featuresAt(planet, surface, 0) === NOTHING) return []

  const here = groundRadiusAt(planet, direction)
  let steep = 0
  if (!atSea) {
    // Slope from two neighbours a fraction of a cell away.
    const eastward = groundRadiusAt(planet, directionOn(face, u + CELL * 0.3, v))
    const northward = groundRadiusAt(planet, directionOn(face, u, v + CELL * 0.3))
    const run = CELL * 0.3 * 0.785
    const rise = Math.hypot(eastward - here, northward - here) / run
    steep = 1 - 1 / Math.sqrt(1 + rise * rise)
  }

  // The groupings the ground is painted by too (grouping.ts): a grove is
  // broad with clearings, an outcrop tighter and sharper-edged, a pavement
  // a patch of ground that is all columns or none.
  const grouping = groupingsAt(planet, x, y, z)
  const groups: Groupings = {
    grove: grouping.grove * 1.4,
    outcrop: grouping.outcrop * 1.6,
    // Only lava cools into pavements; an ice serac stands with the rock.
    pavement: planet.molten ? 0.08 + grouping.pavement * 2.1 : grouping.outcrop * 1.6,
    none: 1,
  }

  const out: Placement[] = []
  const standing = pick(featuresAt(planet, surface, steep), groups, cellHash(word, face, i, j, 3))
  if (standing !== undefined) {
    out.push({
      id: `${String(face)}/${String(i)}/${String(j)}/0`,
      feature: standing,
      direction,
      ground: here,
      surface,
      rolls: [
        cellHash(word, face, i, j, 4),
        cellHash(word, face, i, j, 5),
        cellHash(word, face, i, j, 6),
      ],
      standing: true,
    })
  }
  if (atSea) return out

  const cover = pick(floorAt(planet, surface, steep), groups, cellHash(word, face, i, j, 7))
  if (cover !== undefined) {
    // The floor's own spot in the cell, so it is not under the trunk.
    const fu = (i + 0.1 + cellHash(word, face, i, j, 8) * 0.8) * CELL
    const fv = (j + 0.1 + cellHash(word, face, i, j, 9) * 0.8) * CELL
    const at = directionOn(face, fu, fv)
    out.push({
      id: `${String(face)}/${String(i)}/${String(j)}/1`,
      feature: cover,
      direction: at,
      ground: groundRadiusAt(planet, at),
      surface,
      rolls: [
        cellHash(word, face, i, j, 10),
        cellHash(word, face, i, j, 11),
        cellHash(word, face, i, j, 12),
      ],
      standing: false,
    })
  }
  return out
}
