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
 * Two things keep the count down, and both were measured to matter. Ground
 * outside the view is not split past a coarse level: it is drawn, so a turn
 * reveals a planet rather than a hole, but nobody is looking at its detail.
 * And the horizon is worked out from how high this planet's mountains
 * actually reach, not from a generous guess — at a glide's height the guess
 * alone was splitting ground well past where any of it could be seen.
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
  /** How far above the unit sphere this planet's highest ground can reach. */
  readonly peak: number
}

/** Which way the camera looks, in the planet's frame, and how wide. */
export interface ViewCone {
  /** Unit direction the camera faces. */
  readonly forward: Vec3
  /** From the middle of the view to its corner, in radians. */
  readonly halfAngle: number
}

/** Ground out of view is split no further than this. */
export const UNSEEN_LEVEL = 3

export function centreOf(key: PatchKey): Vec3 {
  const [u, v] = patchUv(key, 0.5, 0.5)
  return directionOn(key.face, u, v)
}

/**
 * Whether a patch lies wholly beyond the horizon. From a distance d the
 * smooth sphere is seen out to acos(1/d) from the point beneath; a peak as
 * high as the planet's highest ground can show above the horizon from
 * acos(1/R) further still. A patch reaches its own angular radius past its
 * centre.
 */
function hidden(key: PatchKey, camera: Vec3, distance: number, peak: number): boolean {
  const centre = centreOf(key)
  const cos = (centre[0] * camera[0] + centre[1] * camera[1] + centre[2] * camera[2]) / distance
  const horizon = Math.acos(Math.min(1, 1 / distance)) + Math.acos(1 / (1 + peak))
  // A patch's corners sit about 0.75 of its span from its centre.
  const reach = patchAngle(key.level) * 0.75
  return Math.acos(Math.max(-1, Math.min(1, cos))) > horizon + reach + 0.02
}

/** Whether a patch lies wholly outside the view, with a margin for turning. */
function unseen(key: PatchKey, camera: Vec3, view: ViewCone): boolean {
  const centre = centreOf(key)
  const dx = centre[0] - camera[0]
  const dy = centre[1] - camera[1]
  const dz = centre[2] - camera[2]
  const gap = Math.hypot(dx, dy, dz) || 1
  const cos = (dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2]) / gap
  const off = Math.acos(Math.max(-1, Math.min(1, cos)))
  // How wide the patch looks from here: close up, a patch beside the camera
  // can fill half the view while its centre is outside it.
  const looks = Math.atan((patchAngle(key.level) * 0.75) / gap)
  return off > view.halfAngle + looks + 0.15
}

export function shouldSplit(
  key: PatchKey,
  camera: Vec3,
  params: LodParams,
  view?: ViewCone,
): boolean {
  if (key.level >= params.maxLevel) return false
  const distance = Math.hypot(camera[0], camera[1], camera[2])
  if (hidden(key, camera, distance, params.peak)) return false
  if (view !== undefined && key.level >= UNSEEN_LEVEL && unseen(key, camera, view)) return false
  const centre = centreOf(key)
  const span = patchAngle(key.level)
  const gap = Math.hypot(camera[0] - centre[0], camera[1] - centre[1], camera[2] - centre[2])
  // Distance to the nearest part of the patch, not its middle: otherwise the
  // patch under the camera reads as far away by half its own width.
  const nearest = Math.max(1e-4, gap - span * 0.75)
  return span / params.segments / nearest > params.threshold
}

export function selectLeaves(
  camera: Vec3,
  params: LodParams,
  view?: ViewCone,
): readonly PatchKey[] {
  const leaves: PatchKey[] = []
  const visit = (key: PatchKey): void => {
    if (shouldSplit(key, camera, params, view)) for (const child of childrenOf(key)) visit(child)
    else leaves.push(key)
  }
  for (const root of ROOTS) visit(root)
  return leaves
}

/**
 * A distance for ordering requests: how far a point is from the camera,
 * stretched for points off to the side or behind. Ground ahead is what the
 * flight is about to reach, so it is asked for first; with no view known it
 * is the plain distance.
 */
export function aheadOf(point: Vec3, camera: Vec3, view?: ViewCone): number {
  const dx = point[0] - camera[0]
  const dy = point[1] - camera[1]
  const dz = point[2] - camera[2]
  const gap = Math.hypot(dx, dy, dz)
  if (view === undefined || gap < 1e-9) return gap
  const cos = (dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2]) / gap
  return gap * (1.5 - 0.5 * cos)
}

/** The patch at a coarser level that contains this one. */
export function ancestorAt(key: PatchKey, level: number): PatchKey {
  const shift = key.level - level
  if (shift <= 0) return key
  return { face: key.face, level, x: key.x >> shift, y: key.y >> shift }
}

/**
 * The tiles of features to stand near the camera: patches at `level`
 * within `range` of it, and in view when the view is known. Found by walking
 * the quadtree down from the faces and leaving any patch wholly out of range
 * — so far from the ground the answer is nothing, at no cost.
 */
export function featureTiles(
  camera: Vec3,
  level: number,
  range: number,
  view?: ViewCone,
): readonly PatchKey[] {
  const tiles: PatchKey[] = []
  const visit = (key: PatchKey): void => {
    const centre = centreOf(key)
    const gap = Math.hypot(camera[0] - centre[0], camera[1] - centre[1], camera[2] - centre[2])
    const reach = patchAngle(key.level) * 0.75
    if (gap - reach > range) return
    if (view !== undefined && key.level >= UNSEEN_LEVEL && unseen(key, camera, view)) return
    if (key.level === level) {
      tiles.push(key)
      return
    }
    for (const child of childrenOf(key)) visit(child)
  }
  for (const root of ROOTS) visit(root)
  return tiles
}
