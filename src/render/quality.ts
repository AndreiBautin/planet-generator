/**
 * How much to draw, decided once from what the device says about itself and
 * then corrected by how it actually performs.
 *
 * Pure, so the thresholds can be tested: a phone that renders a beautiful
 * planet at nine frames a second is a worse demo than one that renders a
 * slightly softer planet smoothly.
 */
export interface Device {
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
  /** `navigator.hardwareConcurrency`; 0 when the browser will not say. */
  readonly cores: number
}

export interface Quality {
  /** Grid squares along a patch's side: the triangles per patch grow with its square. */
  readonly segments: number
  /**
   * How large a vertex spacing may look before a patch splits, as an angle
   * at the eye in radians. Larger is coarser and lighter.
   */
  readonly lodThreshold: number
  /** How many times a face may be halved: the finest ground there is. */
  readonly maxLevel: number
  /**
   * Patches kept in memory. Low down the view wants a few hundred at once,
   * and a cache smaller than that throws away ground it is about to draw.
   */
  readonly patchCache: number
  /** Patch requests out at once: more fills the view faster and uses more of the workers. */
  readonly inFlight: number
  /** How far from the camera trees, rocks and floes stand, in planet radii. */
  readonly featureRange: number
  /** Feature tile requests out at once. */
  readonly featureInFlight: number
  /** Cloud texture width; its height is half. */
  readonly cloudWidth: number
  readonly pixelRatio: number
}

/** Pixel ratios the governor steps down through, highest first. */
export const PIXEL_RATIOS = [2, 1.5, 1.25, 1] as const

export function pickQuality(device: Device): Quality {
  const phone = Math.min(device.width, device.height) < 700
  // An unknown core count is treated as a modest device, not a strong one.
  const modest = device.cores > 0 ? device.cores <= 4 : true
  return {
    segments: 32,
    lodThreshold: phone ? (modest ? 0.016 : 0.012) : modest ? 0.009 : 0.006,
    maxLevel: phone ? 8 : 9,
    patchCache: phone ? (modest ? 450 : 600) : 1200,
    inFlight: phone ? 12 : 24,
    featureRange: phone ? (modest ? 0.05 : 0.07) : 0.11,
    featureInFlight: phone ? 8 : 16,
    cloudWidth: phone ? 512 : 1024,
    pixelRatio: Math.min(device.pixelRatio, modest ? 1.5 : 2),
  }
}

/**
 * The middle frame time of a run, in milliseconds. A median rather than a
 * mean, so one long frame — a planet being uploaded, a tab switch — does not
 * read as a slow device.
 */
export function typicalFrame(samples: readonly number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Slower than this, a frame is dropped on a 60 Hz screen often enough to see. */
export const SLOW_FRAME_MS = 24

/**
 * The next pixel ratio given the current one and a typical frame. Only ever
 * steps down, one step at a time: stepping back up when frames recover is
 * how a governor ends up see-sawing between two settings every few seconds.
 */
export function nextPixelRatio(current: number, frameMs: number): number {
  if (frameMs <= SLOW_FRAME_MS) return current
  const lower = PIXEL_RATIOS.find((ratio) => ratio < current - 0.01)
  return lower ?? current
}
