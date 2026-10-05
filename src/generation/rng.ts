/**
 * A seeded random number generator — the only source of randomness in
 * the app. `Math.random` is a lint error everywhere, because one call
 * slipped into terrain or colour would make the same link open a
 * different planet.
 *
 * sfc32, seeded by hashing the seed string with cyrb128. Small, fast, and
 * defined entirely by 32-bit integer arithmetic, so it gives the identical
 * sequence in every browser and in Node. The literal-value tests pin that:
 * if any of these numbers change, every shared link changes with them.
 */
export interface Rng {
  /** A float in [0, 1). */
  readonly next: () => number
  /** An integer in [min, max], inclusive. */
  readonly int: (min: number, max: number) => number
  /** A float in [min, max). */
  readonly range: (min: number, max: number) => number
  /** A fresh, independent generator derived from this one and a label. */
  readonly fork: (label: string) => Rng
}

/** Four 32-bit words from a string; cyrb128. */
export function hashSeed(text: string): readonly [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let at = 0; at < text.length; at += 1) {
    const k = text.charCodeAt(at)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed)
  const next = (): number => {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    fork: (label) => createRng(`${seed}/${label}`),
  }
}
