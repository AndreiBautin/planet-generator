/**
 * The block a look lands on: a ray walked block by block from the eye
 * along the look (Amanatides & Woo), stopping at the first block that
 * `hits` says is there, and remembering the block it came through — which
 * is where a placed block goes. Pure, so digging can be tested without a
 * renderer.
 */
export interface Hit {
  /** The block struck. */
  readonly x: number
  readonly y: number
  readonly z: number
  /** The empty block the ray came through: against the struck face. */
  readonly before: readonly [number, number, number]
  /** Distance along the ray, in blocks. */
  readonly distance: number
}

export function castBlocks(
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
  reach: number,
  hits: (x: number, y: number, z: number) => boolean,
): Hit | undefined {
  const length = Math.hypot(forward[0], forward[1], forward[2])
  if (!(length > 0) || !(reach > 0)) return undefined
  const d = [forward[0] / length, forward[1] / length, forward[2] / length] as const
  let x = Math.floor(eye[0])
  let y = Math.floor(eye[1])
  let z = Math.floor(eye[2])
  const step = d.map((c) => (c > 0 ? 1 : c < 0 ? -1 : 0)) as [number, number, number]
  const delta = d.map((c) => (c === 0 ? Infinity : Math.abs(1 / c))) as [number, number, number]
  // Distance along the ray to the first boundary on each axis.
  const next = [0, 1, 2].map((axis) => {
    const c = d[axis] ?? 0
    const p = eye[axis] ?? 0
    const i = Math.floor(p)
    if (c > 0) return (i + 1 - p) / c
    if (c < 0) return (p - i) / -c
    return Infinity
  }) as [number, number, number]
  let before: readonly [number, number, number] = [x, y, z]
  let travelled = 0
  for (let steps = 0; steps < reach * 3 + 3; steps += 1) {
    if (hits(x, y, z)) return { x, y, z, before, distance: travelled }
    before = [x, y, z]
    // Step along whichever axis reaches its next boundary first.
    const axis = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2
    travelled = next[axis]
    if (travelled > reach) return undefined
    next[axis] = next[axis] + delta[axis]
    if (axis === 0) x += step[0]
    else if (axis === 1) y += step[1]
    else z += step[2]
  }
  return undefined
}
