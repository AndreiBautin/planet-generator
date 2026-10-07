import { describe, expect, it } from 'vitest'

import { hydrologyOf, waterAt } from './hydrology'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'
import { LONGEST_BRIDGE, settlementsOf, TOWN_LIGHT, townCoverOf } from './settlements'

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

  it('bridges a road over water, bank to bank, and never over a sea', () => {
    // Both ends on dry land, short, and with water between: a river or a lake's narrows.
    const { bridges } = settled
    expect(bridges.length).toBeGreaterThan(3)
    const water = hydrologyOf(temperate)
    const near = new Map<number, readonly number[]>()
    for (const { from, to } of bridges) {
      for (const end of [from, to]) expect(surfaceAt(temperate, ...end).height).toBeGreaterThan(0)
      const span = Math.acos(Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]))
      expect(span).toBeLessThan(LONGEST_BRIDGE)
      let crosses = false
      for (let t = 0.1; t < 1; t += 0.1) {
        const p: [number, number, number] = [0, 1, 2].map(
          (i) => (from[i] ?? 0) * (1 - t) + (to[i] ?? 0) * t,
        ) as [number, number, number]
        const l = Math.hypot(...p)
        const d: [number, number, number] = [p[0] / l, p[1] / l, p[2] / l]
        const here = waterAt(temperate, water, d, near)
        if (
          surfaceAt(temperate, ...d).height <= 0 ||
          here.river >= 0.2 ||
          Number.isFinite(here.lake)
        )
          crosses = true
      }
      expect(crosses).toBe(true)
    }
  })

  it('clears the ground under a house and lays fields round a town, and nothing far off', () => {
    const cover = townCoverOf(temperate)
    expect(cover).toBeDefined()
    if (cover === undefined) return
    const { lights, towns } = settled
    // The first town light: a house stands there.
    let k = 0
    while ((lights[k + 3] ?? 0) < TOWN_LIGHT) k += 5
    const house: [number, number, number] = [lights[k] ?? 0, lights[k + 1] ?? 0, lights[k + 2] ?? 1]
    // Stored as float32, a light comes back a hair off its own point.
    expect(cover(house).house).toBeGreaterThan(0.9)
    // A town's heart is in its fields' reach.
    const heart = towns[0]?.at ?? [0, 0, 1]
    expect(cover(heart).farm).toBeGreaterThan(0.99)
    // The far side of the world from that town, if no other is there, is open.
    const away: [number, number, number] = [-heart[0], -heart[1], -heart[2]]
    const far = cover(away)
    expect(far.house).toBeLessThan(0.01)
    expect(townCoverOf(planetOf('h999999'))).toBeUndefined()
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
