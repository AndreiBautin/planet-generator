import { describe, expect, it } from 'vitest'

import { fixedClock } from '@/app/clock'

import { Profiler } from './profiler'

describe('Profiler', () => {
  it('charges the time since the last mark to each part, and summarises by frame', () => {
    const clock = fixedClock(0)
    const profiler = new Profiler(clock)
    for (const terrain of [2, 4, 30]) {
      profiler.startFrame()
      clock.advance(1)
      profiler.mark('flight')
      clock.advance(terrain)
      profiler.mark('terrain')
    }
    const parts = profiler.take()
    expect(parts['flight']).toEqual({ mean: 1, median: 1, max: 1 })
    // The median ignores the one slow frame; the mean does not.
    expect(parts['terrain']).toEqual({ mean: 12, median: 4, max: 30 })
  })

  it('counts a part missing from a frame as nought, and starts afresh after take', () => {
    const clock = fixedClock(0)
    const profiler = new Profiler(clock)
    profiler.startFrame()
    clock.advance(6)
    profiler.mark('towns')
    profiler.startFrame()
    expect(profiler.take()['towns']).toEqual({ mean: 3, median: 6, max: 6 })
    expect(profiler.take()).toEqual({})
  })
})
