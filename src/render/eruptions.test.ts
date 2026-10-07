import { describe, expect, it } from 'vitest'

import { ERUPTION_PERIOD, eruption, eruptionSeed } from './eruptions'

describe('eruption', () => {
  it('erupts for about a third of its cycle and is quiet the rest', () => {
    // Sampled through a whole cycle: some fountaining, mostly quiet.
    let on = 0
    const samples = 900
    for (let k = 0; k < samples; k += 1)
      if (eruption((k / samples) * ERUPTION_PERIOD, 0.2) > 0.5) on += 1
    expect(on / samples).toBeGreaterThan(0.2)
    expect(on / samples).toBeLessThan(0.4)
  })

  it('keeps each volcano on its own cycle, so they do not all go at once', () => {
    const a = eruptionSeed([0.6, 0.48, 0.64])
    const b = eruptionSeed([-0.3, 0.9, 0.31])
    expect(Math.abs(a - b)).toBeGreaterThan(0.01)
    let disagree = 0
    for (let s = 0; s < ERUPTION_PERIOD; s += 0.5)
      if (eruption(s, a) > 0.5 !== eruption(s, b) > 0.5) disagree += 1
    expect(disagree).toBeGreaterThan(0)
  })
})
