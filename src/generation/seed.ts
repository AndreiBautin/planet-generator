/**
 * The seed a planet is generated from, and how it travels in a link.
 *
 * Seven characters from an alphabet with no look-alikes (no 0/O, 1/l/I),
 * so a seed read aloud or typed from a screenshot comes back right. Parsing
 * is total: anything that is not a valid seed reads as absent, and the
 * caller makes a fresh one — a mangled link opens *a* planet rather than an
 * error page.
 */
export const SEED_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const SEED_LENGTH = 7

export type Seed = string & { readonly __seed: unique symbol }

export function parseSeed(value: unknown): Seed | undefined {
  if (typeof value !== 'string') return undefined
  const seed = value.trim().toLowerCase()
  if (seed.length !== SEED_LENGTH) return undefined
  for (const char of seed) if (!SEED_ALPHABET.includes(char)) return undefined
  return seed as Seed
}

/**
 * A new seed from a source of entropy. The source is a parameter — the
 * browser passes `crypto.getRandomValues`, a test passes fixed bytes — so
 * this function stays pure and the ban on `Math.random` stays absolute.
 */
export function newSeed(fill: (bytes: Uint8Array<ArrayBuffer>) => void): Seed {
  const bytes = new Uint8Array(new ArrayBuffer(SEED_LENGTH))
  fill(bytes)
  let seed = ''
  for (const byte of bytes) seed += SEED_ALPHABET[byte % SEED_ALPHABET.length] ?? '2'
  return seed as Seed
}
