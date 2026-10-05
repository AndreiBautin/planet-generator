import { surfaceAt, type Planet, type Surface } from './planet'
import { fineReliefAt, reliefWeightAt } from './relief'

/**
 * Where the ground is: the one answer to "how far from the centre is the
 * surface in this direction", shared by everything that needs it — the
 * patches the renderer draws, the glide that must stay above them, the
 * features that stand on them, and the voxel world a landing is cut from.
 * They cannot disagree about where the ground is, because they all ask
 * here.
 *
 * Pure: a planet and a direction in, numbers out.
 */

/** The radius the sea's surface is drawn at. */
export const SEA_RADIUS = 1.0015
/** How far above the sea's surface the lowest land sits. */
export const LAND_CLEARANCE = 0.003
/** How far fine relief lifts the ground, in surface-height units. */
export const FINE_RELIEF = 0.11

/**
 * The radius a surface height is drawn at, above 1. Land rises with the
 * relief and stands just clear of the water, so the coast does not flicker
 * where the two surfaces meet; the sea floor sinks more gently, so the
 * water over it is shallow at the coast.
 *
 * The step up to that clearance is a ramp across the shore rather than a
 * jump at height zero. A jump drew a one-cell cliff at every coast, which
 * from orbit was invisible and from low down was a staircase following the
 * grid.
 */
export function liftOf(height: number, relief: number): number {
  const base = height > 0 ? height * relief * 0.7 : height * relief * 0.35
  const t = Math.min(1, Math.max(0, (height + 0.01) / 0.03))
  return base + LAND_CLEARANCE * t * t * (3 - 2 * t)
}

/** The height the ground is drawn at, before it is lifted to a radius. */
export function drawnHeight(
  planet: Planet,
  x: number,
  y: number,
  z: number,
): {
  readonly surface: Surface
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
 * How far from the centre the drawn ground is in a direction, sea floor
 * included: below the sea this is the floor, not the water.
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
 * How far from the centre the drawn ground is in a direction, and never
 * below the sea: what something flying low must stay above. The same
 * arithmetic the patches are built with, so the two cannot disagree about
 * where the ground is.
 */
export function groundRadiusAt(
  planet: Planet,
  direction: readonly [number, number, number],
): number {
  return Math.max(SEA_RADIUS, floorRadiusAt(planet, direction))
}
