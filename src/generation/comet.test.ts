import { describe, expect, it } from 'vitest'

import { cometInSky, cometOf, type Comet } from './comet'
import type { Vec3 } from './cube'
import { parseSeed, SEED_ALPHABET, SEED_LENGTH, type Seed } from './seed'

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe('comet', () => {
  it('hangs in some skies and not others, the same each time', () => {
    // Two hundred seeds spelled out of the seed alphabet.
    const seeds = Array.from({ length: 200 }, (_, k) =>
      parseSeed(
        Array.from(
          { length: SEED_LENGTH },
          (_, d) => SEED_ALPHABET[(k * (d + 3) + d * 7) % SEED_ALPHABET.length] ?? '2',
        ).join(''),
      ),
    ).filter((seed): seed is Seed => seed !== undefined)
    expect(seeds.length).toBe(200)
    const with_ = seeds.filter((seed) => cometOf(seed) !== undefined).length
    expect(with_ / seeds.length).toBeGreaterThan(0.2)
    expect(with_ / seeds.length).toBeLessThan(0.5)
    for (const seed of seeds.slice(0, 20)) expect(cometOf(seed)).toEqual(cometOf(seed))
  })

  it('stands its own distance from the sun, its tail streaming away from it', () => {
    const comet: Comet = { elongation: 0.8, round: 2.1, length: 0.4, curl: 0.3 }
    for (const sun of [
      [1, 0, 0],
      [0, 1, 0],
      [0.3, -0.5, 0.81],
    ] as Vec3[]) {
      const length = Math.hypot(...sun)
      const s: Vec3 = [sun[0] / length, sun[1] / length, sun[2] / length]
      const { head, tail } = cometInSky(comet, sun)
      expect(Math.acos(dot(head, s))).toBeCloseTo(0.8, 6)
      // Along the sky at the head, and away from the sun: a step along the
      // tail moves further from it.
      expect(dot(tail, head)).toBeCloseTo(0, 6)
      expect(dot(tail, s)).toBeLessThan(0)
    }
  })
})
