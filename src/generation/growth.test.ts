import { describe, expect, it } from 'vitest'

import { GROW_MS, grown, treeAt, unkey } from './growth'
import { blockKey } from './voxel'

describe('growth', () => {
  it('reads a block position back out of its key', () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [128, 96, 128],
      [-3, 255, 260],
      [1023, 1, -1024],
    ] as const) {
      expect(unkey(blockKey(x, y, z))).toEqual([x, y, z])
    }
  })

  it('grows a sapling planted long enough ago into a trunk and a crown, and leaves a fresh one', () => {
    const planted = 1_000_000
    const edits = [
      [blockKey(10, 100, 10), 'sapling', planted],
      [blockKey(20, 100, 20), 'sapling', planted + GROW_MS / 2],
      [blockKey(30, 100, 30), 'stone'],
    ] as const
    const later = grown(edits, planted + GROW_MS)
    const blocks = new Map(later.map(([key, block]) => [key, block]))
    expect(blocks.get(blockKey(10, 100, 10))).toBe('wood')
    expect(blocks.get(blockKey(10, 103, 10))).toBe('wood')
    expect(blocks.get(blockKey(10, 105, 10))).toBe('leaves')
    expect(blocks.get(blockKey(20, 100, 20))).toBe('sapling')
    expect(blocks.get(blockKey(30, 100, 30))).toBe('stone')
    expect(later.length).toBe(2 + treeAt(10, 100, 10).length)
  })

  it('changes nothing when nothing is ready, and never grows an undated sapling', () => {
    const edits = [[blockKey(1, 1, 1), 'sapling'] as const]
    expect(grown(edits, Number.MAX_SAFE_INTEGER)).toBe(edits)
  })
})
