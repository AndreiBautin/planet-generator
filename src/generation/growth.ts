import { blockKey, type Block } from './voxel'

/**
 * Growth: a sapling left in the ground becomes a tree, in real time. A
 * plot's edits carry when each sapling was planted; on the next landing
 * every one older than `GROW_MS` is replaced by a trunk and a crown, as
 * edits like any other, so the tree is dug and saved like one.
 *
 * Pure: the clock is a parameter, and the same edits at the same moment
 * grow the same trees.
 */
export const GROW_MS = 8 * 60 * 60 * 1000

/** An edit, with the moment it was made where that matters (a planting). */
export type TimedEdit = readonly [number, Block] | readonly [number, Block, number]

/** The block position a key stands for: the inverse of `blockKey`. */
export function unkey(key: number): readonly [number, number, number] {
  const y = key % 256
  const rest = Math.floor(key / 256)
  const z = (rest % 2048) - 1024
  const x = Math.floor(rest / 2048) - 1024
  return [x, y, z]
}

/** The blocks of a tree grown from a sapling at a position: a trunk and a crown. */
export function treeAt(x: number, y: number, z: number): readonly (readonly [number, Block])[] {
  const out: (readonly [number, Block])[] = []
  const trunk = 4
  for (let dy = 0; dy < trunk; dy += 1) out.push([blockKey(x, y + dy, z), 'wood'])
  const top = y + trunk
  const radius = 2
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -1; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (dx * dx + dy * dy * 1.4 + dz * dz > radius * radius) continue
        if (dx === 0 && dz === 0 && dy < 0) continue
        out.push([blockKey(x + dx, top + dy, z + dz), 'leaves'])
      }
    }
  }
  return out
}

/**
 * The edits with every sapling old enough grown into a tree. A sapling with
 * no planting time is left as it is: nothing is known about when it went
 * in, and growing it at once would be a tree nobody waited for.
 */
export function grown(edits: readonly TimedEdit[], now: number): readonly TimedEdit[] {
  const out: TimedEdit[] = []
  const trees: (readonly [number, Block])[] = []
  for (const edit of edits) {
    const [key, block, at] = edit
    if (block === 'sapling' && at !== undefined && now - at >= GROW_MS) {
      trees.push(...treeAt(...unkey(key)))
    } else {
      out.push(edit)
    }
  }
  if (trees.length === 0) return edits
  // A tree's blocks replace whatever edits stood there; a crown over an
  // earlier edit wins, because the tree is the newer thing.
  const taken = new Set(trees.map(([key]) => key))
  return [...out.filter(([key]) => !taken.has(key)), ...trees]
}
