import { describe, expect, it } from 'vitest'

import { leafSeason, seasonStrength } from './leaves'

const north = 0.7
const south = -0.7
const strong = 1

describe('leafSeason', () => {
  it('leaves the default equinox summer green everywhere', () => {
    // Every link made before the seasons coloured the woods opens on the same woods.
    for (const lat of [north, south, 0.4, -0.45])
      for (const roll of [0, 0.5, 1]) {
        const at = leafSeason(lat, 0.25, strong, roll)
        expect(at.autumn + at.winter + at.spring).toBe(0)
      }
  })

  it('turns the north in autumn while the south comes into spring', () => {
    // Half a year apart: the south's season is the north's plus a half.
    expect(leafSeason(north, 0.35, strong, 0.5).autumn).toBeGreaterThan(0.9)
    expect(leafSeason(south, 0.37, strong, 0.5).spring).toBeGreaterThan(0.9)
    expect(leafSeason(north, 0.55, strong, 0.5).winter).toBeGreaterThan(0.9)
  })

  it('leaves the tropics green, and a world that barely leans barely changes', () => {
    expect(leafSeason(0.05, 0.35, strong, 0.5).autumn).toBe(0)
    expect(leafSeason(north, 0.35, seasonStrength(0.03), 0.5).autumn).toBe(0)
    expect(seasonStrength(0.6)).toBe(1)
  })
})
