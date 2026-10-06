import { describe, expect, it } from 'vitest'

import { blendCover, erosion, FLOW_PERIOD, flowingCoverAt, flowPhases, windAt } from './winds'

/** A cloud map with one storm texel at `col`, on the equator's row. */
function mapWithStorm(width: number, col: number): Uint8Array {
  const height = width / 2
  const data = new Uint8Array(width * height * 4)
  const row = height / 2
  for (let c = col - 1; c <= col + 1; c += 1) data[(row * width + c) * 4] = 255
  return data
}

describe('winds', () => {
  it('blows one way in the tropics and the other at the middle latitudes', () => {
    expect(Math.sign(windAt(0.5))).not.toBe(Math.sign(windAt(0.75)))
  })

  it('keeps one copy of the cloud whole whenever the other is reborn', () => {
    // Were both worn away at once the sky would clear all over, together.
    for (let t = 0; t < FLOW_PERIOD * 2; t += 7) {
      const [a, b] = flowPhases(t)
      expect(Math.min(erosion(a.life), erosion(b.life))).toBe(0)
    }
  })

  it('reborn copies are reborn somewhere new', () => {
    const before = flowPhases(10)[0].shift
    const after = flowPhases(10 + FLOW_PERIOD)[0].shift
    expect(after).not.toBeCloseTo(before, 3)
  })

  it('carries a storm along with the wind', () => {
    const width = 256
    const data = mapWithStorm(width, 128)
    // Find where the storm is drawn now, then a minute later: it has moved.
    const where = (seconds: number): number => {
      let best = -1
      let most = 0
      for (let c = 0; c < width; c += 1) {
        const a = ((c + 0.5) / width - 0.5) * Math.PI * 2
        const cover = flowingCoverAt(data, width, [-Math.cos(a), 0, Math.sin(a)], seconds)
        if (cover > most) {
          most = cover
          best = c
        }
      }
      return best
    }
    const start = FLOW_PERIOD * 0.4
    expect(where(start)).toBeGreaterThanOrEqual(0)
    expect(where(start + 60)).not.toBe(where(start))
  })

  it('blends by keeping the heavier reading, less what each has worn away', () => {
    expect(
      blendCover(0.9, 0.2, [
        { age: 0, shift: 0, life: 0.5 },
        { age: 0, shift: 0, life: 0 },
      ]),
    ).toBeCloseTo(0.9)
  })
})
