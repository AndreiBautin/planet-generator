import { describe, expect, it } from 'vitest'

import { castBlocks } from './raycast'

/** A floor at y < 0 and a pillar at (5, 0..3, 5). */
const hits = (x: number, y: number, z: number): boolean => y < 0 || (x === 5 && z === 5 && y < 4)

describe('castBlocks', () => {
  it('finds the floor straight down, and the block above it to place on', () => {
    const hit = castBlocks([2.5, 1.6, 2.5], [0, -1, 0], 6, hits)
    expect(hit).toMatchObject({ x: 2, y: -1, z: 2, before: [2, 0, 2] })
    expect(hit?.distance).toBeCloseTo(1.6, 6)
  })

  it('finds the pillar along a slanted look, stopping on its near face', () => {
    const hit = castBlocks([2.5, 1.5, 2.5], [1, 0, 1], 8, hits)
    expect(hit).toMatchObject({ x: 5, z: 5 })
    expect(hit?.before).toEqual([4, 1, 5])
  })

  it('finds nothing past its reach, and nothing for a dead look', () => {
    expect(castBlocks([2.5, 1.5, 2.5], [1, 0, 1], 2, hits)).toBeUndefined()
    expect(castBlocks([2.5, 10.5, 2.5], [0, -1, 0], 5, hits)).toBeUndefined()
    expect(castBlocks([2.5, 1.5, 2.5], [0, 0, 0], 5, hits)).toBeUndefined()
  })

  it('reports the block the eye is in when it is itself solid', () => {
    const hit = castBlocks([5.5, 1.5, 5.5], [1, 0, 0], 5, hits)
    expect(hit).toMatchObject({ x: 5, y: 1, z: 5, distance: 0 })
  })
})
