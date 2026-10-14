/**
 * The arithmetic of the development benchmark (`recorder.bench` in main.ts):
 * a fixed seed and route stepped at real-time pace, each frame's numbers
 * summarised here so two runs compare like for like.
 */

export interface BenchFrame {
  /** Time spent in the frame's script, ms (scene.step, timed around it). */
  readonly scriptMs: number
  /** GPU time for the frame, ms, where timer queries exist; NaN otherwise. */
  readonly gpuMs: number
  readonly calls: number
  readonly triangles: number
}

export interface Spread {
  readonly median: number
  readonly p95: number
}

export type BenchSummary = Readonly<Record<keyof BenchFrame, Spread>> & { readonly frames: number }

/** The median and 95th percentile of the finite values; NaN for each when there are none. */
export function spread(values: readonly number[]): Spread {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return { median: Number.NaN, p95: Number.NaN }
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? Number.NaN
  return { median: at(0.5), p95: at(0.95) }
}

export function summarise(frames: readonly BenchFrame[]): BenchSummary {
  return {
    frames: frames.length,
    scriptMs: spread(frames.map((f) => f.scriptMs)),
    gpuMs: spread(frames.map((f) => f.gpuMs)),
    calls: spread(frames.map((f) => f.calls)),
    triangles: spread(frames.map((f) => f.triangles)),
  }
}
