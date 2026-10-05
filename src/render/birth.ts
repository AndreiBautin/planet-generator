/**
 * How a new planet arrives: it swells from a small ball with a slight
 * overshoot, the air glows up around it, and the clouds gather last.
 *
 * Pure, from seconds since the planet was shown, so it plays from the clock
 * like everything else and lands exactly on its final state however the
 * frames fall. Reduced motion skips straight to the end (`BORN`).
 */
export interface Birth {
  readonly scale: number
  /** Cloud opacity as a share of its full value. */
  readonly clouds: number
  /** Atmosphere glow as a share of its full value. */
  readonly air: number
}

export const BIRTH_SECONDS = 1.6
export const BORN: Birth = { scale: 1, clouds: 1, air: 1 }

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Ease out with a small overshoot past 1, settling back onto it. */
function easeOutBack(t: number): number {
  const overshoot = 1.4
  const u = t - 1
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u
}

/** Smoothstep from `start` to `end` seconds. */
function fade(seconds: number, start: number, end: number): number {
  const t = clamp01((seconds - start) / (end - start))
  return t * t * (3 - 2 * t)
}

export function birthAt(seconds: number): Birth {
  if (!(seconds < BIRTH_SECONDS)) return BORN
  const grow = clamp01(seconds / 1.1)
  return {
    scale: 0.3 + 0.7 * easeOutBack(grow),
    air: fade(seconds, 0.25, 1.2),
    clouds: fade(seconds, 0.6, BIRTH_SECONDS),
  }
}
