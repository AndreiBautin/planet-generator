import { describe, expect, it } from 'vitest'

import { coverAt } from './rain'

describe('coverAt', () => {
  it('reads the cloud map the way the layer is drawn: one bright texel, found by direction', () => {
    const width = 64
    const height = 32
    const data = new Uint8Array(width * height * 4)
    // A single heavy cloud at column 48, row 24.
    const col = 48
    const row = 24
    data[(row * width + col) * 4] = 255
    // The direction that maps to it: u = col / width, v = row / height.
    const u = (col + 0.5) / width
    const v = (row + 0.5) / height
    const phi = (u - 0.5) * Math.PI * 2
    const theta = (1 - v) * Math.PI
    const direction: [number, number, number] = [
      -Math.cos(phi) * Math.sin(theta),
      Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
    ]
    expect(coverAt(data, width, direction)).toBe(1)
    expect(coverAt(data, width, [0, 1, 0])).toBe(0)
    expect(coverAt(new Uint8Array(8), 2, direction)).toBe(0)
  })
})
