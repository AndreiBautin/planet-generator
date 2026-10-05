import { createPlanet } from '@/generation/planet'

import type { BuildRequest, Built } from './build-protocol'
import { bakeClouds, sampleSurface } from './surface-data'

/**
 * Makes planets off the main thread, so the page keeps drawing — and the
 * birth animation keeps playing — while a world is sampled. The arrays are
 * transferred rather than copied: the worker gives them up on sending.
 */
self.onmessage = (event: MessageEvent<BuildRequest>) => {
  const request = event.data
  const planet = createPlanet(request.seed, request.dials)
  const surface = sampleSurface(planet, request.detail)
  const clouds = request.cloudWidth > 0 ? bakeClouds(planet, request.cloudWidth) : undefined
  const built: Built = { id: request.id, surface, clouds }
  const transfer: Transferable[] = [
    surface.positions.buffer,
    surface.normals.buffer,
    surface.colours.buffer,
    surface.index.buffer,
  ]
  if (clouds !== undefined) transfer.push(clouds.buffer)
  self.postMessage(built, { transfer })
}
