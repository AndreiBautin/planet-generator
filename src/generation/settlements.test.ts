import { describe, expect, it } from 'vitest'

import { hydrologyOf, waterAt } from './hydrology'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'
import { settlementsOf } from './settlements'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('settlements', () => {
  const temperate = planetOf('83tzj46')
  const settled = settlementsOf(temperate)

  it('puts no light on a river or a lake: each is a house, seen close to', () => {
    const water = hydrologyOf(temperate)
    const near = new Map<number, readonly number[]>()
    const { lights } = settled
    for (let k = 0; k < lights.length; k += 5 * 7) {
      const d: [number, number, number] = [lights[k] ?? 0, lights[k + 1] ?? 0, lights[k + 2] ?? 1]
      const here = waterAt(temperate, water, d, near)
      expect(here.river).toBeLessThan(0.2)
      expect(Number.isFinite(here.lake)).toBe(false)
    }
  })

  it('lives on temperate worlds and not on molten or frozen ones', () => {
    expect(temperate.kind).toBe('temperate')
    expect(settled.towns.length).toBeGreaterThan(20)
    expect(settlementsOf(planetOf('h999999')).towns).toEqual([])
    expect(settlementsOf(planetOf('9tcwfzj')).towns).toEqual([])
  })

  it('puts every town and every light on dry ground, never in snow', () => {
    for (const { at } of settled.towns) {
      const surface = surfaceAt(temperate, ...at)
      expect(surface.height).toBeGreaterThan(0)
      expect(surface.biome).not.toBe('snow')
    }
    const lights = settled.lights
    for (let k = 0; k < lights.length; k += 5 * 17) {
      expect(
        surfaceAt(temperate, lights[k] ?? 0, lights[k + 1] ?? 0, lights[k + 2] ?? 1).height,
      ).toBeGreaterThan(0)
    }
  })

  it('keeps towns apart, the first the largest', () => {
    const towns = settled.towns
    for (let i = 0; i < towns.length; i += 1) {
      for (let j = i + 1; j < towns.length; j += 1) {
        const a = towns[i]?.at ?? [1, 0, 0]
        const b = towns[j]?.at ?? [1, 0, 0]
        expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeLessThan(Math.cos(0.05))
      }
    }
    expect(towns[0]?.size).toBe(1)
  })

  it('is the same from the same seed', () => {
    expect(settlementsOf(planetOf('83tzj46')).lights).toEqual(settled.lights)
  })
})
