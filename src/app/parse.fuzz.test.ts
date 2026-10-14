import { describe, expect, it } from 'vitest'

import { createRng, type Rng } from '@/generation/rng'
import { parseSeed } from '@/generation/seed'

import { parseAtlas } from './atlas'
import { parseConfig } from './config'
import { linkFor, parseLink } from './link'

/**
 * The three trust boundaries — the link, storage and the build's
 * environment — are each promised to be total: whatever arrives, a valid
 * value comes out and nothing throws. The examples in their own tests show
 * the cases someone thought of; this throws thousands nobody did, from a
 * fixed seed so a failure reproduces.
 */

const RUNS = 3000
const PIECES = [
  'seed',
  'sys',
  'shot',
  'w',
  't',
  'r',
  's',
  '=',
  '&',
  ',',
  '-',
  '.',
  'g',
  'o',
  '%',
  '%00',
  '%zz',
  'e9',
  'NaN',
  'Infinity',
  '1e999',
  '__proto__',
  'constructor',
  '<script>',
  '"',
  "'",
  '\u0000',
  '\ud800',
  '🌍',
  ' ',
  '0',
  '9',
  '90',
  '180',
  '360',
  '1000',
  'k3m9xqa',
  'data:image/jpeg;base64,',
]

function junk(rng: Rng, max = 40): string {
  let out = ''
  const parts = rng.int(0, max)
  for (let i = 0; i < parts; i += 1) {
    out +=
      rng.next() < 0.7
        ? (PIECES[rng.int(0, PIECES.length - 1)] ?? '')
        : String.fromCharCode(rng.int(0, 0xffff))
  }
  return out
}

function value(rng: Rng, depth = 0): unknown {
  switch (rng.int(0, depth > 2 ? 5 : 8)) {
    case 0:
      return null
    case 1:
      return undefined
    case 2:
      return rng.range(-1e6, 1e6)
    case 3:
      return [Number.NaN, Infinity, -Infinity, -0][rng.int(0, 3)]
    case 4:
      return rng.next() < 0.5
    case 5:
      return junk(rng)
    case 6:
      return Array.from({ length: rng.int(0, 5) }, () => value(rng, depth + 1))
    default: {
      const keys = [
        'seed',
        'name',
        'kind',
        'dials',
        'visitedAt',
        'kept',
        'home',
        'picture',
        'water',
        '__proto__',
      ]
      return Object.fromEntries(
        Array.from({ length: rng.int(0, 6) }, () => [
          keys[rng.int(0, keys.length - 1)] ?? 'x',
          value(rng, depth + 1),
        ]),
      )
    }
  }
}

const inRange = (n: number, low: number, high: number): boolean =>
  Number.isFinite(n) && n >= low && n <= high

describe('the parsers at the trust boundaries are total', () => {
  it('reads any query string as a link with a valid seed, dials and shot, or none', () => {
    const rng = createRng('fuzz-link')
    for (let i = 0; i < RUNS; i += 1) {
      const link = parseLink(`?${junk(rng)}`)
      if (link.seed !== undefined) expect(parseSeed(link.seed)).toBe(link.seed)
      if (link.home !== undefined) expect(parseSeed(link.home)).toBe(link.home)
      expect(inRange(link.dials.water, 0, 1)).toBe(true)
      expect(inRange(link.dials.temperature, -1, 1)).toBe(true)
      expect(inRange(link.dials.roughness, 0, 1)).toBe(true)
      expect(inRange(link.dials.season, 0, 1)).toBe(true)
      const shot = link.shot
      if (shot !== undefined) {
        expect(inRange(shot.latitude, -90, 90)).toBe(true)
        expect(inRange(shot.longitude, -180, 180)).toBe(true)
        expect(inRange(shot.hour, 0, 24)).toBe(true)
        expect(inRange(shot.bearing, -360, 360)).toBe(true)
        expect(inRange(shot.tilt, -45, 45)).toBe(true)
        expect(inRange(shot.height, 0.004, 6)).toBe(true)
      }
    }
  })

  it('reads a real link with any one piece changed as a valid one, or the plain planet', () => {
    const rng = createRng('fuzz-mutate')
    const real = '?seed=k3m9xqa&w=70&t=-20&s=35&sys=83tzj46&shot=g,-36.734,126.650,270,4.0,10.00,-8'
    let shots = 0
    for (let i = 0; i < RUNS; i += 1) {
      const at = rng.int(0, real.length - 1)
      const mutated = real.slice(0, at) + junk(rng, 2) + real.slice(at + rng.int(0, 3))
      const shot = parseLink(mutated).shot
      if (shot === undefined) continue
      shots += 1
      expect(inRange(shot.latitude, -90, 90) && inRange(shot.longitude, -180, 180)).toBe(true)
      expect(inRange(shot.hour, 0, 24) && inRange(shot.bearing, -360, 360)).toBe(true)
      expect(inRange(shot.tilt, -45, 45) && inRange(shot.height, 0.004, 0.12)).toBe(true)
    }
    // Most changes miss the shot, so it still parses: the checks above ran.
    expect(shots).toBeGreaterThan(RUNS / 4)
  })

  it('writes back every link it reads as one that reads the same', () => {
    const rng = createRng('fuzz-round-trip')
    for (let i = 0; i < RUNS; i += 1) {
      const link = parseLink(`?seed=k3m9xqa&${junk(rng)}`)
      if (link.seed === undefined) continue
      const again = parseLink(linkFor(link.seed, link.dials, undefined, link.home))
      expect(again.dials).toEqual(link.dials)
      expect(again.home ?? again.seed).toBe(link.home ?? link.seed)
    }
  })

  it('reads anything at all from storage as an atlas of valid entries', () => {
    const rng = createRng('fuzz-atlas')
    for (let i = 0; i < RUNS; i += 1) {
      for (const entry of parseAtlas(value(rng))) {
        expect(parseSeed(entry.seed)).toBe(entry.seed)
        expect(parseSeed(entry.home)).toBe(entry.home)
        expect(entry.name.length).toBeLessThanOrEqual(40)
        expect(typeof entry.kept).toBe('boolean')
        if (entry.picture !== undefined) expect(entry.picture).toMatch(/^data:image\/jpeg;base64,/)
      }
    }
  })

  it('reads any environment as a configuration, never turning the developer tools on in a build', () => {
    const rng = createRng('fuzz-config')
    const keys = ['VITE_LOG_LEVEL', 'BASE_URL', 'VITE_BUILD', 'DEV', 'MODE']
    for (let i = 0; i < RUNS; i += 1) {
      const env = Object.fromEntries(keys.map((k) => [k, value(rng)]))
      const { config } = parseConfig(env, false)
      expect(config.developer).toBe(false)
      expect(config.assetBase.startsWith('/') && config.assetBase.endsWith('/')).toBe(true)
      expect(config.build).toMatch(/^(dev|[0-9a-f]{7})$/)
    }
  })
})
