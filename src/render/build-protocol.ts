import type { Dials } from '@/generation/planet'
import type { Seed } from '@/generation/seed'

import type { PatchKey } from './patches/cube'
import type { PatchData } from './patches/patch-data'
import type { Scatter } from './patches/scatter'

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
  | (Planned & { readonly kind: 'features'; readonly key: PatchKey })

export type WorkResult =
  | { readonly id: number; readonly kind: 'clouds'; readonly texture: Uint8Array }
  | { readonly id: number; readonly kind: 'patch'; readonly patch: PatchData }
  | { readonly id: number; readonly kind: 'features'; readonly features: Scatter }
