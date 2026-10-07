import { describe, expect, it } from 'vitest'

import { houseStyle, townSites } from './towns'

/** Five numbers a light, as the worker places them: a point just over the ground, brightness, warmth. */
const light = (angle: number, bright: number): number[] => [
  Math.sin(angle) * 1.0102,
  0,
  Math.cos(angle) * 1.0102,
  bright,
  0.8,
]

describe('towns', () => {
  it('makes a town light a house on the ground, and fainter lights roads', () => {
    const placed = Float32Array.from([
      ...light(0, 0.9),
      // The faintest a town light comes, stored as a float32: a hair under 0.45.
      ...light(0.0005, 0.45),
      ...light(0.01, 0.3),
      ...light(0.0128, 0.3),
      ...light(0.0156, 0.3),
    ])
    const { houses, roads } = townSites(placed)
    expect(houses).toHaveLength(2)
    // Down from the light to the ground it stands on.
    const at = houses[0]?.at ?? [0, 0, 0]
    expect(Math.hypot(...at)).toBeCloseTo(1.01, 6)
    expect(roads).toEqual([expect.any(Array)])
    expect(roads[0]).toHaveLength(3)
  })

  it('breaks a road where its lights are far apart, and drops a road of one', () => {
    const placed = Float32Array.from([
      ...light(0, 0.3),
      ...light(0.002, 0.3),
      // A jump: another road.
      ...light(0.05, 0.3),
      ...light(0.052, 0.3),
      // Alone after a jump: no road at all.
      ...light(0.2, 0.3),
    ])
    const { roads } = townSites(placed)
    expect(roads.map((road) => road.length)).toEqual([2, 2])
  })
})

describe('houseStyle', () => {
  const rolls = Array.from({ length: 40 }, (_, k) => [(k * 0.37) % 1, (k * 0.61) % 1] as const)

  it('builds by the climate: steep where cold, mostly flat where hot and dry', () => {
    for (const [a, b] of rolls) expect(houseStyle(0.1, 0.5, a, b).pitch).toBeGreaterThan(1.1)
    const flat = rolls.filter(([a, b]) => houseStyle(0.3, 0.4, a, b).pitch < 0.1).length
    expect(flat / rolls.length).toBeGreaterThan(0.6)
  })

  it('gives one village several looks, not one house repeated', () => {
    const looks = new Set(
      rolls.map(([a, b]) => {
        const style = houseStyle(0.22, 0.5, a, b)
        return `${style.roof.join()}|${style.walls.join()}`
      }),
    )
    expect(looks.size).toBeGreaterThan(8)
  })
})
