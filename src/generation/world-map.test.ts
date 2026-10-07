import { describe, expect, it } from 'vitest'

import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'
import { bakeMap, mapDirection, mapPoint } from './world-map'

describe('world map', () => {
  it('puts a direction back where it came from', () => {
    for (const [across, down] of [
      [0.5, 0.5],
      [0.1, 0.3],
      [0.93, 0.71],
      [0.25, 0.02],
    ] as const) {
      const [a, d] = mapPoint(mapDirection(across, down))
      expect(a).toBeCloseTo(across, 9)
      expect(d).toBeCloseTo(down, 9)
    }
    // North at the top, the planet's +z at the middle.
    expect(mapPoint([0, 1, 0])[1]).toBeCloseTo(0, 9)
    expect(mapPoint([0, 0, 1])).toEqual([0.5, 0.5])
  })

  it('draws sea where the sea is and land where the land is', () => {
    const seed = parseSeed('k3m9xqa')
    if (seed === undefined) throw new Error('test seed must parse')
    const planet = createPlanet(seed)
    const width = 96
    const map = bakeMap(planet, width)
    expect(map.pixels.length).toBe(width * (width / 2) * 4)
    // A sea pixel is bluer than it is red; most land is not.
    let sea = 0
    let seaBlue = 0
    let land = 0
    let landBlue = 0
    for (let row = 0; row < width / 2; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const [x, y, z] = mapDirection((column + 0.5) / width, (row + 0.5) / (width / 2))
        const k = (row * width + column) * 4
        const blue = (map.pixels[k + 2] ?? 0) > (map.pixels[k] ?? 0)
        if (surfaceAt(planet, x, y, z).height < 0) {
          sea += 1
          if (blue) seaBlue += 1
        } else {
          land += 1
          if (blue) landBlue += 1
        }
      }
    }
    expect(sea).toBeGreaterThan(100)
    expect(land).toBeGreaterThan(100)
    expect(seaBlue / sea).toBeGreaterThan(0.9)
    expect(landBlue / land).toBeLessThan(0.5)
    expect(map.towns.length).toBeGreaterThan(0)
  })

  it('draws a molten world too, with no rivers and no towns', () => {
    const seed = parseSeed('h999999')
    if (seed === undefined) throw new Error('test seed must parse')
    const map = bakeMap(createPlanet(seed), 48)
    expect(map.pixels.length).toBe(48 * 24 * 4)
    expect(map.towns.length).toBe(0)
  })
})
