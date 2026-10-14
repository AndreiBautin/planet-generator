import { describe, expect, it } from 'vitest'

import { adoptHydrology, hydrologyOf } from '@/generation/hydrology'
import { createPlanet, DEFAULT_DIALS } from '@/generation/planet'
import { parseSeed } from '@/generation/seed'

import { answer, transferables } from './work'

describe('the hydrology job', () => {
  const seed = parseSeed('83tzj46')
  if (seed === undefined) throw new Error('test seed did not parse')

  it("hands the page the drainage map it would have made itself, and keeps the worker's own", () => {
    const result = answer({ id: 1, kind: 'hydrology', seed, dials: DEFAULT_DIALS })
    if (result.kind !== 'hydrology') throw new Error('wrong kind')
    // The page's planet adopts it, and asks no more.
    const page = createPlanet(seed, DEFAULT_DIALS)
    expect(adoptHydrology(page, result.hydrology)).toBe(true)
    expect(hydrologyOf(page)).toBe(result.hydrology)
    expect(adoptHydrology(page, result.hydrology)).toBe(false)
    // The same map the page would have made: the seed promise.
    const own = hydrologyOf(createPlanet(seed, DEFAULT_DIALS))
    expect(result.hydrology.height).toEqual(own.height)
    expect(result.hydrology.receiver).toEqual(own.receiver)
    expect(result.hydrology.lake).toEqual(own.lake)
    // Sent buffers are given up; the worker's memo must not be among them.
    const again = answer({ id: 2, kind: 'hydrology', seed, dials: DEFAULT_DIALS })
    if (again.kind !== 'hydrology') throw new Error('wrong kind')
    for (const buffer of transferables(result)) expect(transferables(again)).not.toContain(buffer)
  })
})
