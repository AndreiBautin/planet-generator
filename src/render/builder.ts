import type { ChunkMesh } from '@/generation/chunk'
import type { Vec3 } from '@/generation/cube'
import type { Dials } from '@/generation/planet'
import type { Seed } from '@/generation/seed'
import type { Block } from '@/generation/voxel'
import { logger } from '@/shared/logger'

import type { WorkRequest, WorkResult } from './build-protocol'
import type { PatchKey } from './patches/cube'
import type { PatchData } from './patches/patch-data'
import type { Scatter } from './patches/scatter'
import { answer } from './work'

/**
 * A small pool of workers that make clouds and patches, with each request
 * sent to whichever worker has least waiting. Where a worker cannot be made
 * the same work runs on the page, a request a tick, so the app is slower
 * there and never broken.
 *
 * Nothing here decides what is wanted or whether an answer is still
 * wanted: the terrain asks, and drops what arrives for a planet it no
 * longer shows.
 */
export interface Builder {
  readonly clouds: (seed: Seed, dials: Dials, width: number) => Promise<Uint8Array>
  readonly patch: (seed: Seed, dials: Dials, key: PatchKey, segments: number) => Promise<PatchData>
  readonly features: (seed: Seed, dials: Dials, key: PatchKey) => Promise<Scatter>
  /** A chunk of the landing at `origin`: its mesh and its blocks. */
  readonly chunk: (
    seed: Seed,
    dials: Dials,
    origin: Vec3,
    cx: number,
    cz: number,
    edits: readonly (readonly [number, Block])[],
  ) => Promise<{ readonly mesh: ChunkMesh; readonly blocks: Uint8Array }>
}

interface Lane {
  readonly worker: Worker
  waiting: number
}

export function createBuilder(cores: number): Builder {
  let next = 0
  const settle = new Map<number, (result: WorkResult) => void>()
  // One worker per spare core, up to three: the page keeps one to itself.
  const count = Math.max(1, Math.min(3, cores - 1))
  const lanes: Lane[] = []
  try {
    for (let at = 0; at < count; at += 1) {
      const worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' })
      const lane: Lane = { worker, waiting: 0 }
      worker.onmessage = (event: MessageEvent<WorkResult>) => {
        lane.waiting -= 1
        const resolve = settle.get(event.data.id)
        settle.delete(event.data.id)
        resolve?.(event.data)
      }
      lanes.push(lane)
    }
  } catch {
    logger.warn('builder.no-worker')
  }

  const run = (request: WorkRequest): Promise<WorkResult> => {
    const lane = lanes.reduce<Lane | undefined>(
      (best, candidate) =>
        best === undefined || candidate.waiting < best.waiting ? candidate : best,
      undefined,
    )
    if (lane === undefined) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(answer(request))
        }, 0)
      })
    }
    lane.waiting += 1
    return new Promise((resolve) => {
      settle.set(request.id, resolve)
      lane.worker.postMessage(request)
    })
  }

  return {
    clouds: async (seed, dials, width) => {
      next += 1
      const result = await run({ id: next, kind: 'clouds', seed, dials, width })
      if (result.kind !== 'clouds') throw new Error('builder answered clouds with something else')
      return result.texture
    },
    patch: async (seed, dials, key, segments) => {
      next += 1
      const result = await run({ id: next, kind: 'patch', seed, dials, key, segments })
      if (result.kind !== 'patch') throw new Error('builder answered a patch with something else')
      return result.patch
    },
    chunk: async (seed, dials, origin, cx, cz, edits) => {
      next += 1
      const result = await run({ id: next, kind: 'chunk', seed, dials, origin, cx, cz, edits })
      if (result.kind !== 'chunk') throw new Error('builder answered a chunk with something else')
      return { mesh: result.mesh, blocks: result.blocks }
    },
    features: async (seed, dials, key) => {
      next += 1
      const result = await run({ id: next, kind: 'features', seed, dials, key })
      if (result.kind !== 'features')
        throw new Error('builder answered features with something else')
      return result.features
    },
  }
}
