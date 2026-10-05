import { createPlanet } from '@/generation/planet'
import { logger } from '@/shared/logger'

import type { BuildRequest, Built } from './build-protocol'
import { bakeClouds, sampleSurface } from './surface-data'

/**
 * Builds planets in a worker, and on the main thread where a worker cannot
 * be made — so the app is slower there, never broken.
 *
 * Only the newest request matters: pressing New planet three times quickly
 * should show the third planet, not all three in turn. Each build resolves
 * with `undefined` if a later one was asked for before it finished.
 */
export interface Builder {
  readonly build: (request: Omit<BuildRequest, 'id'>) => Promise<Built | undefined>
}

export function createBuilder(): Builder {
  let latest = 0
  let worker: Worker | undefined
  try {
    worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    logger.warn('builder.no-worker')
    worker = undefined
  }
  const waiting = new Map<number, (built: Built) => void>()
  if (worker !== undefined) {
    worker.onmessage = (event: MessageEvent<Built>) => {
      const resolve = waiting.get(event.data.id)
      waiting.delete(event.data.id)
      resolve?.(event.data)
    }
  }

  return {
    build: async (partial) => {
      latest += 1
      const request: BuildRequest = { ...partial, id: latest }
      const built =
        worker === undefined
          ? buildHere(request)
          : await new Promise<Built>((resolve) => {
              waiting.set(request.id, resolve)
              worker.postMessage(request)
            })
      return built.id === latest ? built : undefined
    },
  }
}

function buildHere(request: BuildRequest): Built {
  const planet = createPlanet(request.seed, request.dials)
  return {
    id: request.id,
    surface: sampleSurface(planet, request.detail),
    clouds: request.cloudWidth > 0 ? bakeClouds(planet, request.cloudWidth) : undefined,
  }
}
