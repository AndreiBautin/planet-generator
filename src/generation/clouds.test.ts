import { describe, expect, it } from 'vitest'

import { cloudDensityAt } from './clouds'
import { createPlanet, type Planet } from './planet'
import { parseSeed, type Seed } from './seed'

const parsed = parseSeed('2257afq')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed

const points = Array.from({ length: 1500 }, (_, at) => {
  const y = 1 - (2 * (at + 0.5)) / 1500
  const ring = Math.sqrt(1 - y * y)
  const angle = at * 2.399963
  return [Math.cos(angle) * ring, y, Math.sin(angle) * ring] as const
})

const cloudyShare = (planet: Planet): number =>
  points.filter(([x, y, z]) => cloudDensityAt(planet, x, y, z) > 0.5).length / points.length

describe('cloudDensityAt', () => {
  it('stays between clear and solid', () => {
    const planet = createPlanet(seed)
    for (const [x, y, z] of points) {
      const density = cloudDensityAt(planet, x, y, z)
      expect(density).toBeGreaterThanOrEqual(0)
      expect(density).toBeLessThanOrEqual(1)
    }
  })

  it('covers more of the sky when the kind asks for more cover', () => {
    const planet = createPlanet(seed)
    const clear = cloudyShare({ ...planet, cloudCover: 0.15 })
    const overcast = cloudyShare({ ...planet, cloudCover: 0.75 })
    expect(overcast).toBeGreaterThan(clear + 0.3)
  })

  it('leaves some sky clear and some cloudy at ordinary cover', () => {
    const share = cloudyShare({ ...createPlanet(seed), cloudCover: 0.5 })
    // Measured as solid cloud; the soft fringes around it add more again.
    expect(share).toBeGreaterThan(0.06)
    expect(share).toBeLessThan(0.6)
  })
})
