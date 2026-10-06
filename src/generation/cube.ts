/**
 * The planet's surface as six square faces of a cube, each pushed out onto
 * the sphere, and each face cut into a quadtree of square patches.
 *
 * Why a cube rather than the icosphere the orbit view used: a patch needs
 * four children that tile it exactly, and a square splits into four
 * squares where a triangle of an icosphere splits awkwardly. The cube's
 * corners would pinch if mapped naively, so a face is warped with a
 * tangent before it is projected, which evens the cells out to within
 * about a third across the face.
 *
 * Pure arithmetic, no Three.js, so the layout can be tested in Node.
 */
export type Vec3 = readonly [number, number, number]
export type Face = 0 | 1 | 2 | 3 | 4 | 5

export interface PatchKey {
  readonly face: Face
  /** 0 is a whole face; each level halves the patch along both sides. */
  readonly level: number
  /** Column and row within the face at this level, from 0 to 2^level − 1. */
  readonly x: number
  readonly y: number
}

interface FaceFrame {
  readonly normal: Vec3
  readonly u: Vec3
  readonly v: Vec3
}

/**
 * Each face's outward normal and the two axes across it, chosen so that
 * u × v is the normal: a grid walked along u then v then winds
 * anticlockwise seen from outside, which is the side Three draws.
 */
export const FACES: readonly FaceFrame[] = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
]

export const ROOTS: readonly PatchKey[] = ([0, 1, 2, 3, 4, 5] as const).map((face) => ({
  face,
  level: 0,
  x: 0,
  y: 0,
}))

export const keyOf = (key: PatchKey): string => [key.face, key.level, key.x, key.y].join('/')

export function childrenOf(key: PatchKey): readonly PatchKey[] {
  const level = key.level + 1
  const x = key.x * 2
  const y = key.y * 2
  return [
    { face: key.face, level, x, y },
    { face: key.face, level, x: x + 1, y },
    { face: key.face, level, x, y: y + 1 },
    { face: key.face, level, x: x + 1, y: y + 1 },
  ]
}

export function parentOf(key: PatchKey): PatchKey | undefined {
  if (key.level === 0) return undefined
  return {
    face: key.face,
    level: key.level - 1,
    x: Math.floor(key.x / 2),
    y: Math.floor(key.y / 2),
  }
}

/** The face coordinates (−1 to 1) of a point s, t (0 to 1) across a patch. */
export function patchUv(key: PatchKey, s: number, t: number): readonly [number, number] {
  const size = 2 / 2 ** key.level
  return [-1 + (key.x + s) * size, -1 + (key.y + t) * size]
}

/**
 * The unit direction for face coordinates u, v. Defined beyond −1 to 1 as
 * well, which is what lets a patch sample one ring past its own edge to
 * light its border.
 */
export function directionOn(face: Face, u: number, v: number): Vec3 {
  const frame = FACES[face]
  if (frame === undefined) throw new Error(`no face ${String(face)}`)
  const wu = Math.tan((u * Math.PI) / 4)
  const wv = Math.tan((v * Math.PI) / 4)
  const x = frame.normal[0] + wu * frame.u[0] + wv * frame.v[0]
  const y = frame.normal[1] + wu * frame.u[1] + wv * frame.v[1]
  const z = frame.normal[2] + wu * frame.u[2] + wv * frame.v[2]
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** The angle a patch spans across, roughly: a quarter turn halved per level. */
export const patchAngle = (level: number): number => Math.PI / 2 / 2 ** level

/** The patch at `level` that holds a direction: the inverse of `directionOn`, cut to a grid. */
export function patchAt(direction: Vec3, level: number): PatchKey {
  let face: Face = 0
  let best = -Infinity
  FACES.forEach((frame, index) => {
    const along =
      direction[0] * frame.normal[0] +
      direction[1] * frame.normal[1] +
      direction[2] * frame.normal[2]
    if (along > best) {
      best = along
      face = index as Face
    }
  })
  const frame = FACES[face] ?? FACES[0]
  if (frame === undefined) throw new Error('no faces')
  const dot = (a: Vec3): number => direction[0] * a[0] + direction[1] * a[1] + direction[2] * a[2]
  const u = (Math.atan(dot(frame.u) / best) * 4) / Math.PI
  const v = (Math.atan(dot(frame.v) / best) * 4) / Math.PI
  const cells = 2 ** level
  const cell = (w: number): number =>
    Math.min(cells - 1, Math.max(0, Math.floor(((w + 1) / 2) * cells)))
  return { face, level, x: cell(u), y: cell(v) }
}

/**
 * The patch of the same level across each edge, crossing onto the next face
 * where the edge is a face's: bottom, top, left, right, as `edgeOrder` in
 * patch-data.ts walks them.
 */
export function neighboursOf(key: PatchKey): readonly PatchKey[] {
  const past = 0.5 / 2 ** key.level / 4
  const at = (s: number, t: number): PatchKey => {
    const [u, v] = patchUv(key, s, t)
    return patchAt(directionOn(key.face, u, v), key.level)
  }
  const size = 2 / 2 ** key.level
  const step = past / size
  return [at(0.5, -step), at(0.5, 1 + step), at(-step, 0.5), at(1 + step, 0.5)]
}
