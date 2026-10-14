import { describe, expect, it } from 'vitest'

import type { Vec3 } from '@/generation/cube'
import { createPlanet, surfaceAt } from '@/generation/planet'
import { parseSeed } from '@/generation/seed'

import { unit } from './frames'
import { alongTheLand, coastAround, landNear } from './places'

const seed = parseSeed('83tzj46')
if (seed === undefined) throw new Error('test seed must parse')
const world = createPlanet(seed)
const heightAt = (d: Vec3): number => surfaceAt(world, d[0], d[1], d[2]).height

/** Directions spread over the sphere, from a fixed lattice. */
const directions: Vec3[] = Array.from({ length: 60 }, (_, k) => {
  const z = 1 - (2 * (k + 0.5)) / 60
  const angle = k * 2.399963
  const r = Math.sqrt(1 - z * z)
  return [Math.cos(angle) * r, z, Math.sin(angle) * r]
})

describe('places', () => {
  it('lands a dive over dry ground wherever it starts, sea included', () => {
    for (const under of directions) {
      const land = landNear(world, under, unit([under[2], 0, -under[0]]))
      expect(Math.hypot(...land)).toBeCloseTo(1, 6)
      expect(heightAt(land)).toBeGreaterThan(0.04)
    }
  })

  it('heads a glide along land rather than out to sea, as a unit tangent', () => {
    for (const under of directions) {
      const position = landNear(world, under, unit([under[2], 0, -under[0]]))
      const heading = alongTheLand(world, position, unit([position[2], 0, -position[0]]))
      expect(Math.hypot(...heading)).toBeCloseTo(1, 6)
      const radial = heading[0] * position[0] + heading[1] * position[1] + heading[2] * position[2]
      expect(Math.abs(radial)).toBeLessThan(1e-6)
    }
  })

  it('reads coast as 0 to 1, and more of it at a shore than over open sea or deep inland', () => {
    const values = directions.map((d) => coastAround(world, d))
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of values) expect(v).toBeLessThanOrEqual(1)
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values))
  })
})
