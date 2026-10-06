import { createPlanet, type Planet } from '@/generation/planet'

import type { WorkRequest, WorkResult } from './build-protocol'
import { samplePatch } from './patches/patch-data'
import { bakeClouds } from './surface-data'

/**
 * Answers one request — the work itself, the same whether it runs in a
 * worker or, where none can be made, on the page.
 *
 * Planets are kept for the last couple of seed-and-dials pairs asked about:
 * a planet streams in as a hundred patch requests, and making the planet
 * afresh for each would cost more than most of the patches.
 */
const planets = new Map<string, Planet>()

function planetFor(request: WorkRequest): Planet {
  const { water, temperature, roughness } = request.dials
  const name = `${request.seed}|${String(water)}|${String(temperature)}|${String(roughness)}`
  const known = planets.get(name)
  if (known !== undefined) return known
  const planet = createPlanet(request.seed, request.dials)
  if (planets.size >= 2) {
    const oldest = planets.keys().next().value
    if (oldest !== undefined) planets.delete(oldest)
  }
  planets.set(name, planet)
  return planet
}

export function answer(request: WorkRequest): WorkResult {
  const planet = planetFor(request)
  switch (request.kind) {
    case 'clouds':
      return { id: request.id, kind: 'clouds', texture: bakeClouds(planet, request.width) }
    case 'patch':
      return {
        id: request.id,
        kind: 'patch',
        patch: samplePatch(planet, request.key, request.segments),
      }
  }
}

/** The buffers a result can hand over rather than copy. */
export function transferables(result: WorkResult): Transferable[] {
  switch (result.kind) {
    case 'clouds':
      return [result.texture.buffer]
    case 'patch':
      return [
        result.patch.positions.buffer,
        result.patch.normals.buffer,
        result.patch.colours.buffer,
        result.patch.pattern.buffer,
        result.patch.coarsePositions.buffer,
        result.patch.coarseNormals.buffer,
        result.patch.coarseColours.buffer,
        result.patch.coarsePattern.buffer,
        result.patch.ice.buffer,
        result.patch.mist.buffer,
        result.patch.ground.buffer,
        result.patch.water.buffer,
      ]
  }
}
