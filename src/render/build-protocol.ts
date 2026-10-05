import type { Dials } from '@/generation/planet'
import type { Seed } from '@/generation/seed'

import type { SurfaceData } from './surface-data'

/**
 * What goes to the builder and what comes back. A request carries the seed
 * and dials rather than a planet, because a planet holds noise functions and
 * functions do not cross to a worker; the worker makes its own from the
 * same seed, which by the seed promise is the same planet.
 */
export interface BuildRequest {
  readonly id: number
  readonly seed: Seed
  readonly dials: Dials
  readonly detail: number
  /** Texture width for the clouds, or 0 when the caller still has them. */
  readonly cloudWidth: number
}

export interface Built {
  readonly id: number
  readonly surface: SurfaceData
  readonly clouds: Uint8Array | undefined
}
