import { describe, expect, it } from 'vitest'

import { createRng, hashSeed } from './rng'
import { SEED_ALPHABET, SEED_LENGTH, newSeed, parseSeed } from './seed'

describe('the seeded generator', () => {
  /*
   * Literal values, on purpose. "Same seed, same sequence" passes for a
   * generator that changed between releases, as long as it changed
   * consistently — and every link anybody ever shared would then open a
   * different planet. These numbers are the promise.
   */
  it('produces the same sequence for a seed, forever', () => {
    const rng = createRng('k3m9xqa')
    const first = [rng.next(), rng.next(), rng.next()]
    expect(first.map((value) => value.toFixed(10))).toMatchInlineSnapshot(`
      [
        "0.3587565972",
        "0.8494307690",
        "0.0894228267",
      ]
    `)
    expect(hashSeed('k3m9xqa')).toMatchInlineSnapshot(`
      [
        2312653057,
        1714478222,
        3831978759,
        1808683869,
      ]
    `)
  })

  it('gives different seeds different sequences', () => {
    expect(createRng('aaaaaaa').next()).not.toBe(createRng('aaaaaab').next())
  })

  it('keeps forks independent of each other and of the parent', () => {
    const terrain = createRng('k3m9xqa').fork('terrain').next()
    const clouds = createRng('k3m9xqa').fork('clouds').next()
    expect(terrain).not.toBe(clouds)
    // Drawing from the parent does not move a fork: adding a feature later
    // must not reshape terrain that already existed.
    const parent = createRng('k3m9xqa')
    parent.next()
    expect(parent.fork('terrain').next()).toBe(terrain)
  })

  it('stays inside its ranges', () => {
    const rng = createRng('range01')
    for (let at = 0; at < 1000; at += 1) {
      const value = rng.int(3, 5)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(5)
    }
  })
})

describe('seeds', () => {
  it('reads a valid seed, case and spaces forgiven', () => {
    expect(parseSeed(' K3M9XQA ')).toBe('k3m9xqa')
  })

  it('reads anything else as absent rather than throwing', () => {
    expect(parseSeed('k3m9xq')).toBeUndefined()
    expect(parseSeed('k3m9xq0')).toBeUndefined() // 0 is not in the alphabet
    expect(parseSeed(42)).toBeUndefined()
    expect(parseSeed(undefined)).toBeUndefined()
  })

  it('makes a new seed from the entropy it is handed', () => {
    const seed = newSeed((bytes) => {
      bytes.fill(0)
    })
    expect(seed).toHaveLength(SEED_LENGTH)
    expect(seed).toBe(SEED_ALPHABET[0]?.repeat(SEED_LENGTH))
    expect(parseSeed(seed)).toBe(seed)
  })
})
