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
