import {
  childrenOf,
  directionOn,
  patchAngle,
  patchUv,
  ROOTS,
  type PatchKey,
  type Vec3,
} from './cube'

/**
 * Which patches to draw from where the camera is: the quadtree split until
 * every patch's vertex spacing, seen from the camera, is under a threshold.
 * Near ground splits deep and far ground stays coarse, so a phone can draw
 * a mountain at its feet and the horizon behind it.
 *
 * Pure: the camera is a position in the planet's own frame (so a turning
 * planet does not need re-splitting for turning), and the answer is the
 * list of leaves. The leaves tile the sphere exactly once.
 */
export interface LodParams {
  /** Grid squares along each side of a patch. */
  readonly segments: number
  /**
   * The largest a vertex spacing may look, as an angle at the eye, in
   * radians. Smaller is finer and costs more patches.
   */
  readonly threshold: number
  readonly maxLevel: number
}

/** How far the ground can rise above the unit sphere, at most; keeps the test honest near mountains. */
const GROUND_ALLOWANCE = 0.08

export function centreOf(key: PatchKey): Vec3 {
  const [u, v] = patchUv(key, 0.5, 0.5)
  return directionOn(key.face, u, v)
}

/**
 * Whether a patch lies wholly beyond the horizon. From a distance d the
 * smooth sphere is seen out to acos(1/d) from the point beneath; a peak as
 * high as the allowance can show above the horizon from acos(1/R) further
 * still. A patch reaches its own angular radius past its centre.
 */
function hidden(key: PatchKey, camera: Vec3, distance: number): boolean {
  const centre = centreOf(key)
  const cos = (centre[0] * camera[0] + centre[1] * camera[1] + centre[2] * camera[2]) / distance
  const horizon = Math.acos(Math.min(1, 1 / distance)) + Math.acos(1 / (1 + GROUND_ALLOWANCE))
  // A patch's corners sit about 0.75 of its span from its centre.
  const reach = patchAngle(key.level) * 0.75
  return Math.acos(Math.max(-1, Math.min(1, cos))) > horizon + reach + 0.05
}

export function shouldSplit(key: PatchKey, camera: Vec3, params: LodParams): boolean {
  if (key.level >= params.maxLevel) return false
  const distance = Math.hypot(camera[0], camera[1], camera[2])
  if (hidden(key, camera, distance)) return false
  const centre = centreOf(key)
  const span = patchAngle(key.level)
  const gap = Math.hypot(camera[0] - centre[0], camera[1] - centre[1], camera[2] - centre[2])
  // Distance to the nearest part of the patch, not its middle: otherwise the
  // patch under the camera reads as far away by half its own width.
  const nearest = Math.max(1e-4, gap - span * 0.75)
  return span / params.segments / nearest > params.threshold
}

export function selectLeaves(camera: Vec3, params: LodParams): readonly PatchKey[] {
  const leaves: PatchKey[] = []
  const visit = (key: PatchKey): void => {
    if (shouldSplit(key, camera, params)) for (const child of childrenOf(key)) visit(child)
    else leaves.push(key)
  }
  for (const root of ROOTS) visit(root)
  return leaves
}
