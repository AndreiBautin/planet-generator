import { describe, expect, it } from 'vitest'

import { DEFAULT_DIALS } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

import { linkFor, parseLink } from './link'

const parsed = parseSeed('k7fq2xm')
if (parsed === undefined) throw new Error('test seed must parse')
const seed: Seed = parsed

describe('link', () => {
  it('round-trips a seed and its dials', () => {
    const dials = { water: 0.7, temperature: -0.2, roughness: 0.35 }
    const link = parseLink(linkFor(seed, dials))
    expect(link.seed).toBe(seed)
    expect(link.dials).toEqual(dials)
  })

  it('leaves a dial at its default out of the link', () => {
    expect(linkFor(seed, DEFAULT_DIALS)).toBe('?seed=k7fq2xm')
    expect(linkFor(seed, { ...DEFAULT_DIALS, water: 0.7 })).toBe('?seed=k7fq2xm&w=70')
  })

  it('reads a missing dial as its default', () => {
    expect(parseLink('?seed=k7fq2xm').dials).toEqual(DEFAULT_DIALS)
  })

  it('reads a garbled or out-of-range dial as its default rather than failing', () => {
    const { dials } = parseLink('?seed=k7fq2xm&w=lots&t=-500&r=1e3')
    expect(dials).toEqual(DEFAULT_DIALS)
  })

  it('keeps the dials it can read when another is garbled', () => {
    expect(parseLink('?w=20&t=oops').dials).toEqual({ ...DEFAULT_DIALS, water: 0.2 })
  })

  it('reads a link with no seed as one to make a seed for', () => {
    expect(parseLink('').seed).toBeUndefined()
    expect(parseLink('?seed=nope').seed).toBeUndefined()
  })
})

describe('a postcard link', () => {
  const dials = DEFAULT_DIALS
  it('round-trips a glide to its stored precision', () => {
    const shot = {
      kind: 'glide' as const,
      latitude: 12.3456,
      longitude: -67.891,
      bearing: 215.4,
      height: 0.0163,
      hour: 17.257,
      tilt: -12.4,
    }
    const link = parseLink(linkFor(seed, dials, shot))
    expect(link.seed).toBe(seed)
    expect(link.shot?.kind).toBe('glide')
    expect(link.shot?.latitude).toBeCloseTo(12.346, 3)
    expect(link.shot?.longitude).toBeCloseTo(-67.891, 3)
    expect(link.shot?.bearing).toBe(215)
    expect(link.shot?.height).toBeCloseTo(0.0163, 4)
    expect(link.shot?.hour).toBeCloseTo(17.26, 2)
    expect(link.shot?.tilt).toBe(-12)
  })

  it('reads a glide written without a tilt as level', () => {
    expect(parseLink('?seed=k7fq2xm&shot=g,1,2,3,16,12').shot?.tilt).toBe(0)
  })

  it('round-trips an orbit', () => {
    const shot = {
      kind: 'orbit' as const,
      latitude: -5,
      longitude: 170,
      bearing: 0,
      height: 3.2,
      hour: 6.5,
      tilt: 0,
    }
    expect(parseLink(linkFor(seed, dials, shot)).shot).toEqual(shot)
  })

  it('is a plain planet when the shot is garbled or out of range', () => {
    for (const bad of [
      'x,1,2,3,4',
      'g,1,2,3,4',
      'g,95,0,0,16,12',
      'g,0,0,0,900,12',
      'o,0,0,40,12',
      'o,0,0,3,25',
      'g,0,0,0,16,lots',
    ]) {
      const link = parseLink(`?seed=k7fq2xm&shot=${bad}`)
      expect(link.shot).toBeUndefined()
      expect(link.seed).toBe(seed)
    }
  })

  it('leaves the shot out of a plain link', () => {
    expect(parseLink(linkFor(seed, dials)).shot).toBeUndefined()
  })
})
