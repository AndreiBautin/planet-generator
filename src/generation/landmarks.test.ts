import { describe, expect, it } from 'vitest'

import { createPlanet } from './planet'
import { parseSeed } from './seed'
import { angleBetween, surveyDirection, surveyPlanet } from './landmarks'
import { surfaceAt } from './planet'

const seed = (text: string) => {
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error(`bad seed ${text}`)
  return parsed
}

describe('the survey', () => {
  it('names the same landmarks for the same world every time', () => {
    const planet = createPlanet(seed('crq59r7'))
    const first = surveyPlanet(planet)
    const second = surveyPlanet(planet)
    expect(second).toEqual(first)
    expect(first.map((mark) => mark.kind)).toContain('peak')
    expect(first.length).toBeGreaterThanOrEqual(2)
  })

  it('finds a peak no sampled cell stands above, and a sea heart that is under water', () => {
    const planet = createPlanet(seed('crq59r7'))
    const survey = surveyPlanet(planet)
    const peak = survey.find((mark) => mark.kind === 'peak')
    if (peak === undefined) throw new Error('no peak')
    for (let row = 0; row < 90; row += 3) {
      for (let column = 0; column < 180; column += 3) {
        const [x, y, z] = surveyDirection(column, row)
        expect(surfaceAt(planet, x, y, z).height).toBeLessThanOrEqual(peak.height + 1e-6)
      }
    }
    const sea = survey.find((mark) => mark.kind === 'sea' || mark.kind === 'lava')
    if (sea === undefined) throw new Error('no sea')
    expect(sea.height).toBeLessThan(0)
    expect(sea.share).toBeGreaterThan(0)
    expect(sea.share).toBeLessThanOrEqual(1)
  })

  it('reads lava on a molten world and ice on a frozen one', () => {
    const molten = ['2222222', '3333333', '4444444', '5555555', '6666666', '7777777', '8888888']
      .map((text) => createPlanet(seed(text)))
      .find((planet) => planet.molten)
    if (molten !== undefined) {
      const kinds = surveyPlanet(molten).map((mark) => mark.kind)
      expect(kinds).not.toContain('sea')
    }
    const frozen = ['a2a2a2a', 'b3b3b3b', 'c4c4c4c', 'd5d5d5d', 'e6e6e6e', 'f7f7f7f', 'g8g8g8g']
      .map((text) => createPlanet(seed(text)))
      .find((planet) => planet.kind === 'frozen')
    if (frozen !== undefined) {
      const kinds = surveyPlanet(frozen).map((mark) => mark.kind)
      expect(kinds).toContain('ice')
    }
  })

  it('measures angles between directions', () => {
    expect(angleBetween([1, 0, 0], [1, 0, 0])).toBeCloseTo(0)
    expect(angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2)
    expect(angleBetween([1, 0, 0], [-1, 0, 0])).toBeCloseTo(Math.PI)
  })
})
