import { describe, expect, it } from 'vitest'

import { MOON_STRENGTH, moonlightOf } from './moonlight'

describe('moonlight', () => {
  const sun = [1, 0, 0] as const
  const big = { direction: [-1, 0, 0] as const, radius: 0.12 }

  it('is full opposite the sun and nothing beside it', () => {
    expect(moonlightOf([big], sun, 1).strength).toBeCloseTo(MOON_STRENGTH, 6)
    expect(moonlightOf([{ ...big, direction: [1, 0, 0] }], sun, 1).strength).toBe(0)
  })

  it('is a quarter at the quarter, and less for a small moon', () => {
    const quarter = moonlightOf([{ ...big, direction: [0, 0, 1] }], sun, 1).strength
    expect(quarter).toBeCloseTo(MOON_STRENGTH * 0.25, 6)
    const small = moonlightOf([{ direction: [-1, 0, 0], radius: 0.05 }], sun, 1).strength
    expect(small).toBeCloseTo(MOON_STRENGTH * 0.5, 6)
  })

  it('counts a moon only once it has risen over the eye', () => {
    const risen = moonlightOf([big], sun, 1, [-1, 0, 0]).strength
    const set = moonlightOf([big], sun, 1, [1, 0, 0]).strength
    expect(risen).toBeCloseTo(MOON_STRENGTH, 6)
    expect(set).toBe(0)
  })

  it('takes the brightest moon and goes out by day', () => {
    const faint = { direction: [0, 0, 1] as const, radius: 0.12 }
    const lit = moonlightOf([faint, big], sun, 1)
    expect(lit.direction).toEqual(big.direction)
    expect(moonlightOf([big], sun, 0).strength).toBe(0)
    expect(moonlightOf([], sun, 1).strength).toBe(0)
  })
})
