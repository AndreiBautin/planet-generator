import type { Dials } from '@/generation/planet'
import type { Seed } from '@/generation/seed'

import type { PatchKey } from './patches/cube'
import type { PatchData } from './patches/patch-data'

/**
 * What goes to a builder worker and what comes back. A request carries the
 * seed and dials rather than a planet, because a planet holds noise
 * functions and functions do not cross to a worker; the worker makes its
 * own from the same seed, which by the seed promise is the same planet.
 */
interface Planned {
  readonly id: number
  readonly seed: Seed
  readonly dials: Dials
}

export type WorkRequest =
  | (Planned & { readonly kind: 'clouds'; readonly width: number })
  | (Planned & { readonly kind: 'patch'; readonly key: PatchKey; readonly segments: number })
  | (Planned & { readonly kind: 'lights' })

export type WorkResult =
  | { readonly id: number; readonly kind: 'clouds'; readonly texture: Uint8Array }
  | { readonly id: number; readonly kind: 'patch'; readonly patch: PatchData }
  /** Towns' lights, five numbers each: a position on the ground, brightness and warmth. */
  | {
      readonly id: number
      readonly kind: 'lights'
      readonly lights: Float32Array
      /** The towns' glow on the ground, `CITY_GLOW_WIDTH` wide (settlements.ts, `townGlow`). */
      readonly glow: Uint8Array
    }
