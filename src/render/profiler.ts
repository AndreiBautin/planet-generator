import type { Clock } from '@/app/clock'

export interface PartTimes {
  readonly mean: number
  readonly median: number
  readonly max: number
}

/**
 * The frame split by part, for `recorder.profile()`: each `mark` charges the
 * time since the last one to its name, within the current frame, and `take`
 * summarises every frame since it was last called. Read medians — a single
 * collection or compile lands in whichever part was running.
 */
export class Profiler {
  private readonly times = new Map<string, number[]>()
  private frames = 0
  private markedAt = 0

  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  startFrame(): void {
    this.markedAt = this.clock.now()
    this.frames += 1
  }

  mark(name: string): void {
    if (this.frames === 0) return
    const at = this.clock.now()
    let times = this.times.get(name)
    if (times === undefined) this.times.set(name, (times = []))
    times[this.frames - 1] = (times[this.frames - 1] ?? 0) + at - this.markedAt
    this.markedAt = at
  }

  take(): Record<string, PartTimes> {
    const out: Record<string, PartTimes> = {}
    for (const [name, times] of this.times) {
      const each = Array.from({ length: this.frames }, (_, k) => times[k] ?? 0).sort(
        (a, b) => a - b,
      )
      out[name] = {
        mean: each.reduce((a, b) => a + b, 0) / Math.max(1, each.length),
        median: each[Math.floor(each.length / 2)] ?? 0,
        max: each[each.length - 1] ?? 0,
      }
    }
    this.times.clear()
    this.frames = 0
    return out
  }
}
