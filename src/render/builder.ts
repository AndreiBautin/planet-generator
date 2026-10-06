import type { Dials } from '@/generation/planet'
import type { Seed } from '@/generation/seed'
import { logger } from '@/shared/logger'

import type { WorkRequest, WorkResult } from './build-protocol'
import type { PatchKey } from './patches/cube'
import type { PatchData } from './patches/patch-data'
import type { Scatter } from './patches/scatter'
import { answer } from './work'

/**
 * A small pool of workers that make clouds and patches. Requests wait in
 * one queue, most urgent first, and a worker takes the next one only when
 * it is free: posted straight to a worker, a patch of trees just ahead
 * queued behind terrain asked for a second earlier and arrived as the eye
 * flew over it. Where a worker cannot be made
 * the same work runs on the page, a request a tick, so the app is slower
 * there and never broken.
 *
 * Nothing here decides what is wanted or whether an answer is still
 * wanted: the terrain asks, and drops what arrives for a planet it no
 * longer shows.
 */
export interface Builder {
  readonly clouds: (seed: Seed, dials: Dials, width: number) => Promise<Uint8Array>
  /** `urgency`: lower is sooner; about how far the patch is from the eye. */
  readonly patch: (
    seed: Seed,
    dials: Dials,
    key: PatchKey,
    segments: number,
    /** The share of its cells' features the patch carries (scatter.ts). */
    keep: number,
    urgency?: number,
  ) => Promise<BuiltPatch>
}

/** A patch of ground and what stands on it, made together. */
export interface BuiltPatch {
  readonly patch: PatchData
  readonly features: Scatter
}

interface Queued {
  readonly request: WorkRequest
  readonly urgency: number
  readonly resolve: (result: WorkResult) => void
}

interface Lane {
  readonly worker: Worker
  /** Requests handed to it and not yet answered. */
  held: number
}

/**
 * How many requests a worker holds at once. Two, so it starts the next the
 * moment it finishes one: with one, it sat idle until the page — busy
 * drawing a frame — got round to handing it more. Few enough that the
 * queue, not the worker, still decides what comes next.
 */
const HOLD = 2

export function createBuilder(cores: number): Builder {
  let next = 0
  const settle = new Map<number, (result: WorkResult) => void>()
  const queue: Queued[] = []
  // One worker per spare core, up to three: the page keeps one to itself.
  const count = Math.max(1, Math.min(3, cores - 1))
  const lanes: Lane[] = []
  try {
    for (let at = 0; at < count; at += 1) {
      const worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' })
      const lane: Lane = { worker, held: 0 }
      worker.onmessage = (event: MessageEvent<WorkResult>) => {
        lane.held -= 1
        const resolve = settle.get(event.data.id)
        settle.delete(event.data.id)
        resolve?.(event.data)
        dispatch()
      }
      lanes.push(lane)
    }
  } catch {
    logger.warn('builder.no-worker')
  }

  // The most urgent waiting request, taken out of the queue.
  const nextUp = (): Queued | undefined => {
    let best = -1
    queue.forEach((item, at) => {
      const current = queue[best]
      if (current === undefined || item.urgency < current.urgency) best = at
    })
    return best < 0 ? undefined : queue.splice(best, 1)[0]
  }
  let onPage = false
  function dispatch(): void {
    if (lanes.length === 0) {
      // No workers: one request a tick on the page, most urgent first.
      if (onPage) return
      const item = nextUp()
      if (item === undefined) return
      onPage = true
      setTimeout(() => {
        onPage = false
        item.resolve(answer(item.request))
        dispatch()
      }, 0)
      return
    }
    for (let round = 0; round < HOLD; round += 1) {
      for (const lane of lanes) {
        if (lane.held > round) continue
        const item = nextUp()
        if (item === undefined) return
        lane.held += 1
        settle.set(item.request.id, item.resolve)
        lane.worker.postMessage(item.request)
      }
    }
  }
  const run = (request: WorkRequest, urgency: number): Promise<WorkResult> =>
    new Promise((resolve) => {
      queue.push({ request, urgency, resolve })
      dispatch()
    })

  return {
    clouds: async (seed, dials, width) => {
      next += 1
      const result = await run({ id: next, kind: 'clouds', seed, dials, width }, -1)
      if (result.kind !== 'clouds') throw new Error('builder answered clouds with something else')
      return result.texture
    },
    patch: async (seed, dials, key, segments, keep, urgency = 0) => {
      next += 1
      const result = await run(
        { id: next, kind: 'patch', seed, dials, key, segments, keep },
        urgency,
      )
      if (result.kind !== 'patch') throw new Error('builder answered a patch with something else')
      return { patch: result.patch, features: result.features }
    },
  }
}
