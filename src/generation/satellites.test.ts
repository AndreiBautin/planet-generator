import { describe, expect, it } from 'vitest'

import { createPlanet } from './planet'
import { satellitesOf } from './satellites'
import { parseSeed } from './seed'

const planetOf = (text: string) => {
  const seed = parseSeed(text)
  if (seed === undefined) throw new Error(`test seed ${text} must parse`)
  return createPlanet(seed)
}
const SEEDS = [
  '83tzj46',
  '7skewpv',
  'pd36566',
  '4thfxgk',
  'm9dv5k3',
  '5s4et67',
  '6a7u8x4',
  'dze3383',
]

describe('satellitesOf', () => {
  it('is the same sky every time for a seed', () => {
    const a = satellitesOf(planetOf('83tzj46'))
    const b = satellitesOf(planetOf('83tzj46'))
    expect(a.moons.map((m) => m.distance)).toEqual(b.moons.map((m) => m.distance))
    expect(Array.from(a.moons[0]?.surface.slice(0, 50) ?? [])).toEqual(
      Array.from(b.moons[0]?.surface.slice(0, 50) ?? []),
    )
    expect(a.rings?.inner).toEqual(b.rings?.inner)
  })

  it('keeps every moon clear of the rings and of every other moon', () => {
    for (const text of SEEDS) {
      const { moons, rings } = satellitesOf(planetOf(text))
      for (const moon of moons) {
        expect(moon.distance - moon.radius).toBeGreaterThan((rings?.outer ?? 1) + 0.5)
      }
      for (let k = 1; k < moons.length; k += 1) {
        const inner = moons[k - 1]
        const outer = moons[k]
        if (inner === undefined || outer === undefined) continue
        expect(outer.distance - outer.radius).toBeGreaterThan(inner.distance + inner.radius)
      }
    }
  })

  it('gives some worlds moons and some rings, and no molten world rings', () => {
    let moons = 0
    let ringed = 0
    for (let k = 0; k < 60; k += 1) {
      const digits = '23456789'
      const text = `${(SEEDS[k % SEEDS.length] ?? '').slice(0, 5)}${digits[k % 8] ?? '2'}${digits[Math.floor(k / 8) % 8] ?? '2'}`
      const planet = planetOf(text)
      const sky = satellitesOf(planet)
      moons += sky.moons.length > 0 ? 1 : 0
      ringed += sky.rings !== undefined ? 1 : 0
      if (planet.molten) expect(sky.rings).toBeUndefined()
    }
    expect(moons).toBeGreaterThan(30)
    expect(ringed).toBeGreaterThan(4)
    expect(ringed).toBeLessThan(40)
  })

  it('cuts the rings into bands with a clean gap, fading at both edges', () => {
    const ringed = SEEDS.map((s) => satellitesOf(planetOf(s)).rings).find((r) => r !== undefined)
    if (ringed === undefined) return
    const bands = Array.from(ringed.bands)
    expect(bands[0]).toBeLessThan(0.1)
    expect(bands[bands.length - 1]).toBeLessThan(0.1)
    expect(Math.min(...bands.slice(20, -20))).toBeLessThan(0.05)
    expect(Math.max(...bands)).toBeGreaterThan(0.4)
  })
})
