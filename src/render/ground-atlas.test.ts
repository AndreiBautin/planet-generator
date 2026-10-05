import { describe, expect, it } from 'vitest'

import { bakeGroundTile, GROUND_KINDS, TILE } from './ground-atlas'

const texel = (data: Uint8Array, col: number, row: number, channel: number): number =>
  data[(row * TILE + col) * 4 + channel] ?? 0

describe('ground atlas', () => {
  it('bakes every kind as a full square with real variation in it', () => {
    for (const kind of GROUND_KINDS) {
      const { data } = bakeGroundTile(kind)
      expect(data.length).toBe(TILE * TILE * 4)
      const greens = new Set<number>()
      const heights = new Set<number>()
      for (let at = 0; at < data.length; at += 4 * 97) {
        greens.add(data[at + 1] ?? 0)
        heights.add(data[at + 3] ?? 0)
      }
      expect(greens.size).toBeGreaterThan(8)
      expect(heights.size).toBeGreaterThan(8)
    }
  })

  it('tiles: the seam is no sharper than the sharpest step inside the square', () => {
    for (const kind of GROUND_KINDS) {
      const { data } = bakeGroundTile(kind)
      let seam = 0
      let inside = 0
      for (let at = 0; at < TILE; at += 3) {
        for (const channel of [0, 1, 2, 3]) {
          // The last column against the first, and the last row against the
          // first: one texel apart across the seam.
          seam = Math.max(
            seam,
            Math.abs(texel(data, TILE - 1, at, channel) - texel(data, 0, at, channel)),
            Math.abs(texel(data, at, TILE - 1, channel) - texel(data, at, 0, channel)),
          )
          // Neighbours well inside the square, for what a step there is.
          for (const c of [40, 100, 160, 220]) {
            inside = Math.max(
              inside,
              Math.abs(texel(data, c, at, channel) - texel(data, c + 1, at, channel)),
              Math.abs(texel(data, at, c, channel) - texel(data, at, c + 1, channel)),
            )
          }
        }
      }
      expect(seam, kind).toBeLessThanOrEqual(Math.max(inside, 12))
    }
  })

  it('keeps its colours near the middle, so the biome colour still shows through', () => {
    for (const kind of GROUND_KINDS) {
      const { data } = bakeGroundTile(kind)
      let sum = 0
      let count = 0
      for (let at = 0; at < data.length; at += 4) {
        sum += ((data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0)) / 3
        count += 1
      }
      const mean = sum / count / 255
      expect(mean, kind).toBeGreaterThan(0.3)
      expect(mean, kind).toBeLessThan(0.7)
    }
  })
})
