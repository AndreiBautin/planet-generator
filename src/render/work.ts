import { chunkBlocks, meshChunk } from '@/generation/chunk'
import { createPlanet, type Planet } from '@/generation/planet'
import { cacheOf } from '@/generation/cache'
import { surveyPlanet } from '@/generation/landmarks'
import { blockKey, landingAt, type Landing } from '@/generation/voxel'

import type { WorkRequest, WorkResult } from './build-protocol'
import { samplePatch } from './patches/patch-data'
import { scatterPatch } from './patches/scatter'
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

/**
 * The landing is kept for the last point asked about: a landing streams in
 * as a hundred chunk requests, and stamping its features takes longer than
 * most of the chunks.
 */
let held: { readonly name: string; readonly landing: Landing } | undefined

/** Where each planet's cache is; surveyed once per planet, which is a tenth of a second. */
const caches = new WeakMap<Planet, readonly [number, number, number]>()
function cacheFor(planet: Planet): readonly [number, number, number] {
  const known = caches.get(planet)
  if (known !== undefined) return known
  const direction = cacheOf(planet, surveyPlanet(planet)).direction
  caches.set(planet, direction)
  return direction
}

function landingFor(planet: Planet, origin: readonly [number, number, number]): Landing {
  const name = `${planet.seed}|${origin.map((n) => n.toFixed(9)).join(',')}`
  if (held?.name === name) return held.landing
  const landing = landingAt(planet, origin, cacheFor(planet))
  held = { name, landing }
  return landing
}

/** The linear colours of a planet's palette, the way the chunk mesher wants them. */
function linear([r, g, b]: readonly [number, number, number]): readonly [number, number, number] {
  const one = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [one(r), one(g), one(b)]
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
    case 'features':
      return { id: request.id, kind: 'features', features: scatterPatch(planet, request.key) }
    case 'chunk': {
      const landing = landingFor(planet, request.origin)
      const blocks = chunkBlocks(landing, request.cx, request.cz, new Map(request.edits), blockKey)
      const mesh = meshChunk(blocks, {
        lush: linear(planet.palette.lush),
        dry: linear(planet.palette.dry),
        highland: linear(planet.palette.highland),
        peak: linear(planet.palette.peak),
        ice: linear(planet.palette.ice),
        shallow: linear(planet.palette.shallow),
      })
      return { id: request.id, kind: 'chunk', mesh, blocks }
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
      ]
    case 'features':
      return Object.values(result.features).map((features) => features.buffer)
    case 'chunk':
      return [
        result.mesh.positions.buffer,
        result.mesh.normals.buffer,
        result.mesh.colours.buffer,
        result.mesh.tiles.buffer,
        result.mesh.uvs.buffer,
        result.mesh.index.buffer,
        result.mesh.fluid.positions.buffer,
        result.mesh.fluid.normals.buffer,
        result.mesh.fluid.index.buffer,
        result.blocks.buffer,
      ]
  }
}
