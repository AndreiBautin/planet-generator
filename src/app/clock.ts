/**
 * Time, taken as a parameter. The animation loop reads frame time from a
 * Clock rather than from `performance.now()`, so a test (or a recorded
 * flyover) can drive time explicitly. The lint rule forbidding the ambient
 * calls is switched off in this file only.
 */
export interface Clock {
  /** Milliseconds, monotonic, for frame timing. */
  readonly now: () => number
}

export const systemClock: Clock = {
  now: () => performance.now(),
}

/** A clock that only moves when told to; for tests. */
export function fixedClock(start = 0): Clock & { readonly advance: (ms: number) => void } {
  let at = start
  return {
    now: () => at,
    advance: (ms) => {
      at += ms
    },
  }
}
