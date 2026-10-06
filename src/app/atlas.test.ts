import { describe, expect, it } from 'vitest'

import { DEFAULT_DIALS } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

import { keep, parseAtlas, picture, RECENT_LIMIT, shelves, visit, type AtlasEntry } from './atlas'

const seedOf = (raw: string): Seed => {
  const seed = parseSeed(raw)
  if (seed === undefined) throw new Error(`test seed ${raw} must parse`)
  return seed
}

const world = (raw: string): Pick<AtlasEntry, 'seed' | 'name' | 'kind' | 'dials'> => ({
  seed: seedOf(raw),
  name: `World ${raw}`,
  kind: 'temperate',
  dials: DEFAULT_DIALS,
})

/** Seeds that parse: seven characters of the seed alphabet. */
const seeds = Array.from(
  { length: 40 },
  (_, k) =>
    `k3m9x${'abcdefghjkmnpqrstuvwxyz23456789'[k % 31] ?? 'a'}${'abcdefgh'[Math.floor(k / 31)] ?? 'a'}`,
)

describe('the atlas', () => {
  it('puts a visit first, and a second visit to the same world moves it rather than adding it', () => {
    let atlas = visit([], world(seeds[0] ?? ''), 1)
    atlas = visit(atlas, world(seeds[1] ?? ''), 2)
    atlas = visit(atlas, { ...world(seeds[0] ?? ''), dials: { ...DEFAULT_DIALS, water: 0.9 } }, 3)
    expect(atlas.map((e) => e.seed)).toEqual([seeds[0], seeds[1]])
    expect(atlas[0]?.dials.water).toBe(0.9)
    expect(atlas[0]?.visitedAt).toBe(3)
  })

  it('keeps its picture and its keeping across a visit', () => {
    let atlas = visit([], world(seeds[0] ?? ''), 1)
    atlas = picture(atlas, seedOf(seeds[0] ?? ''), 'data:image/jpeg;base64,xx')
    atlas = keep(atlas, seedOf(seeds[0] ?? ''), true)
    atlas = visit(atlas, world(seeds[0] ?? ''), 2)
    expect(atlas[0]?.picture).toBe('data:image/jpeg;base64,xx')
    expect(atlas[0]?.kept).toBe(true)
  })

  it('lets the oldest unkept worlds go, never a kept one', () => {
    let atlas = visit([], world(seeds[0] ?? ''), 0)
    atlas = keep(atlas, seedOf(seeds[0] ?? ''), true)
    for (let k = 1; k < 35; k += 1) atlas = visit(atlas, world(seeds[k] ?? ''), k)
    const { kept, recent } = shelves(atlas)
    expect(kept.map((e) => e.seed)).toEqual([seeds[0]])
    expect(recent).toHaveLength(RECENT_LIMIT)
    expect(recent[0]?.seed).toBe(seeds[34])
  })

  it('reads anything back from storage as an atlas, dropping what it cannot trust', () => {
    expect(parseAtlas('nonsense')).toEqual([])
    expect(parseAtlas(null)).toEqual([])
    const back = parseAtlas([
      { seed: seeds[0], name: 'A', kind: 'frozen', dials: { water: 9 }, visitedAt: 5, kept: true },
      { seed: 'not a seed!', name: 'B' },
      { seed: seeds[0], name: 'duplicate' },
      { seed: seeds[1], picture: 'javascript:alert(1)' },
      42,
    ])
    expect(back.map((e) => e.seed)).toEqual([seeds[0], seeds[1]])
    expect(back[0]?.dials).toEqual({ ...DEFAULT_DIALS })
    expect(back[0]?.kept).toBe(true)
    expect(back[1]?.picture).toBeUndefined()
  })

  it('round-trips through JSON', () => {
    let atlas = visit([], world(seeds[2] ?? ''), 7)
    atlas = picture(atlas, seedOf(seeds[2] ?? ''), 'data:image/jpeg;base64,abc')
    expect(parseAtlas(JSON.parse(JSON.stringify(atlas)))).toEqual(atlas)
  })
})
