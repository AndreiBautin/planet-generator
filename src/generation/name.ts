import type { Rng } from './rng'

/**
 * A pronounceable name for a planet, from its seed: two or three syllables
 * built from an onset and a vowel, with an occasional closing consonant
 * and, rarely, a catalogue number. Deterministic — the same seed is always
 * called the same thing — and drawn from its own fork, so naming never
 * shifts the terrain.
 */
const ONSETS = [
  'k',
  'v',
  't',
  'r',
  'z',
  'm',
  'n',
  's',
  'th',
  'dr',
  'kr',
  'l',
  'y',
  'qu',
  'h',
  'p',
  'b',
  'x',
]
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ar', 'or', 'y']
const CODAS = ['n', 'r', 's', 'x', 'th', 'l', 'm']

const pick = <T>(rng: Rng, list: readonly T[]): T => {
  const item = list[rng.int(0, list.length - 1)]
  if (item === undefined) throw new Error('pick from an empty list')
  return item
}

export function planetName(rng: Rng): string {
  const syllables = rng.next() < 0.7 ? 2 : 3
  let name = ''
  for (let at = 0; at < syllables; at += 1) {
    // Every syllable opens on a consonant: letting one open on its vowel
    // ran vowels together into "Ree" and "Vyyio".
    name += pick(rng, ONSETS)
    name += pick(rng, VOWELS)
  }
  if (rng.next() < 0.45) name += pick(rng, CODAS)
  const proper = name.charAt(0).toUpperCase() + name.slice(1)
  return rng.next() < 0.18 ? `${proper}-${String(rng.int(2, 99))}` : proper
}

/** A name for a place on a planet: the planet's own sounds, never a catalogue number. */
export function placeName(rng: Rng): string {
  const syllables = rng.next() < 0.6 ? 2 : 3
  let name = ''
  for (let at = 0; at < syllables; at += 1) name += pick(rng, ONSETS) + pick(rng, VOWELS)
  if (rng.next() < 0.5) name += pick(rng, CODAS)
  return name.charAt(0).toUpperCase() + name.slice(1)
}
