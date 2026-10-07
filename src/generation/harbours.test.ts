import { describe, expect, it } from 'vitest'

import { harboursOf } from './harbours'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const planetOf = (raw: string): ReturnType<typeof createPlanet> => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error('test seed must parse')
  return createPlanet(seed)
}

describe('harbours', () => {
  const world = planetOf('83tzj46')
  const { harbours, lanes } = harboursOf(world)
  const sea = (d: readonly [number, number, number]): boolean =>
    surfaceAt(world, d[0], d[1], d[2]).height < 0

  it('puts each on a shore, land behind it and open sea at its mouth', () => {
    expect(harbours.length).toBeGreaterThan(5)
    for (const harbour of harbours) {
      expect(sea(harbour.shore)).toBe(false)
      expect(sea(harbour.mouth)).toBe(true)
      // Out to sea is along the ground, not up out of it.
      const up = harbour.shore
      expect(
        Math.abs(up[0] * harbour.out[0] + up[1] * harbour.out[1] + up[2] * harbour.out[2]),
      ).toBeLessThan(1e-9)
    }
  })

  it('sails its lanes over open water only', () => {
    // A ship sailing across land would be the first thing a glide saw.
    expect(lanes.length).toBeGreaterThan(3)
    for (const lane of lanes) for (const point of lane) expect(sea(point)).toBe(true)
  })

  it('stands a lighthouse on the land at the edge of the water', () => {
    // On land, so it is not drawn in the sea; at the edge, so the sea can see it.
    const lit = harbours.filter((harbour) => harbour.light !== undefined)
    expect(lit.length).toBeGreaterThan(harbours.length / 3)
    for (const harbour of lit) {
      const light = harbour.light ?? harbour.shore
      expect(sea(light)).toBe(false)
      const ring = Array.from({ length: 16 }, (_, k) => round(light, 0.001, (k / 16) * Math.PI * 2))
      expect(ring.some(sea)).toBe(true)
    }
  })

  it('has none on an unsettled world', () => {
    expect(harboursOf(planetOf('h999999')).harbours).toEqual([])
  })
})

type Vec3 = readonly [number, number, number]

/** A point `distance` radians from `centre`, at `bearing` round it. */
function round(centre: Vec3, distance: number, bearing: number): Vec3 {
  const helper: Vec3 = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit([
    helper[1] * centre[2] - helper[2] * centre[1],
    helper[2] * centre[0] - helper[0] * centre[2],
    helper[0] * centre[1] - helper[1] * centre[0],
  ])
  const e2: Vec3 = [
    centre[1] * e1[2] - centre[2] * e1[1],
    centre[2] * e1[0] - centre[0] * e1[2],
    centre[0] * e1[1] - centre[1] * e1[0],
  ]
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  return unit([
    centre[0] * c + (e1[0] * Math.cos(bearing) + e2[0] * Math.sin(bearing)) * s,
    centre[1] * c + (e1[1] * Math.cos(bearing) + e2[1] * Math.sin(bearing)) * s,
    centre[2] * c + (e1[2] * Math.cos(bearing) + e2[2] * Math.sin(bearing)) * s,
  ])
}

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
