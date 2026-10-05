import { DEFAULT_DIALS, type Dials } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

/**
 * A planet's address: `?seed=k7fq2xm&w=70&t=-20&r=35`.
 *
 * The seed decides the world and the dials move it; together they are the
 * whole of what a link has to carry for somebody else to see exactly this
 * planet. Dials travel as whole percentages because a link is read by
 * people too, and a dial left at its default is left out of the link.
 *
 * Parsing is total, like the seed's: a dial that is missing, garbled or out
 * of range reads as its default, so a hand-edited link still opens a planet.
 */
export interface Link {
  readonly seed: Seed | undefined
  readonly dials: Dials
}

const KEYS = { water: 'w', temperature: 't', roughness: 'r' } as const
const RANGES = {
  water: [0, 1],
  temperature: [-1, 1],
  roughness: [0, 1],
} as const satisfies Record<keyof Dials, readonly [number, number]>

function readDial(params: URLSearchParams, dial: keyof Dials): number {
  const raw = params.get(KEYS[dial])
  if (raw === null || !/^-?\d{1,3}$/.test(raw.trim())) return DEFAULT_DIALS[dial]
  const [low, high] = RANGES[dial]
  const value = Number(raw) / 100
  return value < low || value > high ? DEFAULT_DIALS[dial] : value
}

export function parseLink(search: string): Link {
  const params = new URLSearchParams(search)
  return {
    seed: parseSeed(params.get('seed')),
    dials: {
      water: readDial(params, 'water'),
      temperature: readDial(params, 'temperature'),
      roughness: readDial(params, 'roughness'),
    },
  }
}

export function linkFor(seed: Seed, dials: Dials): string {
  const params = new URLSearchParams({ seed })
  for (const dial of ['water', 'temperature', 'roughness'] as const) {
    const percent = Math.round(dials[dial] * 100)
    if (percent !== Math.round(DEFAULT_DIALS[dial] * 100)) params.set(KEYS[dial], String(percent))
  }
  return `?${params.toString()}`
}
