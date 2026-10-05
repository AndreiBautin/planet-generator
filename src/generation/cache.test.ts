import { describe, expect, it } from 'vitest'

import { alongArc, cacheOf, scopeInFlight, scopeOnFoot } from './cache'
import { angleBetween, LANDMARK_PHRASES, surveyPlanet } from './landmarks'
import { createPlanet, surfaceAt } from './planet'
import { parseSeed } from './seed'

const seed = (text: string) => {
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error(`bad seed ${text}`)
  return parsed
}

describe('the cache', () => {
  it('is buried in the same place every time, on dry ground, with a clue naming two landmarks', () => {
    const planet = createPlanet(seed('crq59r7'))
    const survey = surveyPlanet(planet)
    const cache = cacheOf(planet, survey)
    expect(cacheOf(planet, survey)).toEqual(cache)
    const [x, y, z] = cache.direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(surfaceAt(planet, x, y, z).height).toBeGreaterThanOrEqual(0.012)
    const named = Object.values(LANDMARK_PHRASES).filter((phrase) => cache.clue.includes(phrase))
    expect(named.length).toBe(2)
  })

  it('lies on the arc between the two landmarks it names, give or take the walk ashore', () => {
    const planet = createPlanet(seed('jky7rt6'))
    const survey = surveyPlanet(planet)
    const cache = cacheOf(planet, survey)
    const named = survey.filter((mark) => cache.clue.includes(LANDMARK_PHRASES[mark.kind]))
    expect(named.length).toBe(2)
    const [a, b] = named
    if (a === undefined || b === undefined) throw new Error('unnamed')
    // Somewhere along the arc is within the ashore search of the cache.
    let nearest = Infinity
    for (let share = 0; share <= 1; share += 0.01) {
      nearest = Math.min(
        nearest,
        angleBetween(alongArc(a.direction, b.direction, share), cache.direction),
      )
    }
    expect(nearest).toBeLessThan(0.11)
  })

  it('differs between worlds', () => {
    const a = createPlanet(seed('crq59r7'))
    const b = createPlanet(seed('jky7rt6'))
    expect(cacheOf(a, surveyPlanet(a)).direction).not.toEqual(cacheOf(b, surveyPlanet(b)).direction)
  })

  it('reads warmer the nearer it gets, in the air and on foot', () => {
    expect(scopeInFlight(Math.PI)).toBe('cold')
    expect(scopeInFlight(0.5)).toBe('cool')
    expect(scopeInFlight(0.2)).toBe('warm')
    expect(scopeInFlight(0.08)).toBe('hot')
    expect(scopeInFlight(0.01)).toBe('burning')
    expect(scopeOnFoot(200)).toBe('cold')
    expect(scopeOnFoot(60)).toBe('cool')
    expect(scopeOnFoot(30)).toBe('warm')
    expect(scopeOnFoot(10)).toBe('hot')
    expect(scopeOnFoot(3)).toBe('burning')
  })
})
