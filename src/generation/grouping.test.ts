import { describe, expect, it } from 'vitest'

import { groupingsAt } from './grouping'
import { createPlanet } from './planet'
import { parseSeed, type Seed } from './seed'

const parsed = parseSeed('2257afq')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed
const planet = createPlanet(seed)

describe('groupingsAt', () => {
  it('makes woods as stands: mostly solid or bare, little in between', () => {
    let solid = 0
    let bare = 0
    let between = 0
    let total = 0
    for (let i = 0; i < 4000; i += 1) {
      const a = i * 0.618
      const b = i * 0.137
      const x = Math.sin(a) * Math.cos(b)
      const y = Math.sin(a) * Math.sin(b)
      const z = Math.cos(a)
      const { grove } = groupingsAt(planet, x, y, z)
      total += 1
      if (grove > 0.75) solid += 1
      else if (grove < 0.15) bare += 1
      else between += 1
    }
    expect(solid / total).toBeGreaterThan(0.15)
    expect(bare / total).toBeGreaterThan(0.25)
    expect(between / total).toBeLessThan(0.25)
  })

  it('lays rock in outcrops too: mostly solid or bare', () => {
    let between = 0
    let total = 0
    for (let i = 0; i < 4000; i += 1) {
      const a = i * 0.618
      const b = i * 0.137
      const { outcrop } = groupingsAt(
        planet,
        Math.sin(a) * Math.cos(b),
        Math.sin(a) * Math.sin(b),
        Math.cos(a),
      )
      total += 1
      if (outcrop > 0.15 && outcrop < 0.85) between += 1
    }
    expect(between / total).toBeLessThan(0.2)
  })

  it('is the same answer for the same spot', () => {
    expect(groupingsAt(planet, 0.3, 0.4, 0.866)).toEqual(groupingsAt(planet, 0.3, 0.4, 0.866))
  })
})
