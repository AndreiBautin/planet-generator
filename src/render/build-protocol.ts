import type { Dials } from '@/generation/planet'
import type { Seed } from '@/generation/seed'
import type { Harbours } from '@/generation/harbours'
import type { Hydrology } from '@/generation/hydrology'
import type { Landmark } from '@/generation/landmarks'
import type { Volcano } from '@/generation/volcanoes'
import type { Ruin } from '@/generation/ruins'
import type { WorldMap } from '@/generation/world-map'

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
  | (Planned & { readonly kind: 'falls' })
  | (Planned & { readonly kind: 'hydrology' })
  | (Planned & { readonly kind: 'sights' })
  | (Planned & { readonly kind: 'map'; readonly width: number })

export type WorkResult =
  | { readonly id: number; readonly kind: 'clouds'; readonly texture: Uint8Array }
  | { readonly id: number; readonly kind: 'patch'; readonly patch: PatchData }
  /** The world laid flat (generation/world-map.ts). */
  | { readonly id: number; readonly kind: 'map'; readonly map: WorldMap }
  /** Waterfalls, five numbers each: the foot's direction, its ground radius, and how far it drops. */
  | { readonly id: number; readonly kind: 'falls'; readonly falls: Float32Array }
  /** The drainage map (generation/hydrology.ts), copied out of the worker's own. */
  | { readonly id: number; readonly kind: 'hydrology'; readonly hydrology: Hydrology }
  /** The tour's sights and a molten world's volcanoes: both read the drainage map. */
  | {
      readonly id: number
      readonly kind: 'sights'
      readonly landmarks: readonly Landmark[]
      readonly volcanoes: readonly Volcano[]
    }
  /** Towns' lights, five numbers each: a position on the ground, brightness and warmth. */
  | {
      readonly id: number
      readonly kind: 'lights'
      readonly lights: Float32Array
      /** The towns' glow on the ground, `CITY_GLOW_WIDTH` wide (settlements.ts, `townGlow`). */
      readonly glow: Uint8Array
      /** The coastal towns' harbours and the sea lanes between them (harbours.ts). */
      readonly harbours: Harbours
      /** The ruins on its hilltops (ruins.ts). */
      readonly ruins: readonly Ruin[]
      /** Where roads cross water, eight numbers each: each bank's direction and its ground's radius. */
      readonly bridges: Float32Array
    }
