import { createPlanet, type Planet } from '@/generation/planet'

import type { WorkRequest, WorkResult } from './build-protocol'
import { settlementsOf, townGlow } from '@/generation/settlements'
import { waterfallsOf } from '@/generation/waterfalls'
import { harboursOf } from '@/generation/harbours'

import { groundRadiusAt, samplePatch } from './patches/patch-data'
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
  // Every dial in the name: a planet kept under a name that left one out
  // (the season, once) was handed back after that dial moved, and the
  // ground came out as it was before.
  const { water, temperature, roughness, season } = request.dials
  const name = `${request.seed}|${String(water)}|${String(temperature)}|${String(roughness)}|${String(season)}`
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
    case 'lights':
      return {
        id: request.id,
        kind: 'lights',
        lights: placedLights(planet),
        glow: townGlow(settlementsOf(planet).towns, CITY_GLOW_WIDTH),
        harbours: harboursOf(planet),
      }
    case 'falls':
      return { id: request.id, kind: 'falls', falls: placedFalls(planet) }
  }
}

/** The waterfalls with their feet's ground radius: they need the drainage map, made here, off the page. */
function placedFalls(planet: Planet): Float32Array {
  const falls = waterfallsOf(planet)
  const out = new Float32Array(falls.length * 5)
  falls.forEach(({ at, drop }, k) => {
    out.set([at[0], at[1], at[2], groundRadiusAt(planet, at), drop], k * 5)
  })
  return out
}

/** How wide the towns' glow map is: a texel is about a hundredth of a radius at the equator. */
export const CITY_GLOW_WIDTH = 1024

/** The towns' lights stood on the drawn ground: the costly part of them, so made here, off the page. */
function placedLights(planet: Planet): Float32Array {
  const lights = settlementsOf(planet).lights
  const out = new Float32Array(lights.length)
  for (let k = 0; k < lights.length; k += 5) {
    const d: [number, number, number] = [lights[k] ?? 0, lights[k + 1] ?? 0, lights[k + 2] ?? 1]
    const radius = groundRadiusAt(planet, d) + 0.0002
    out[k] = d[0] * radius
    out[k + 1] = d[1] * radius
    out[k + 2] = d[2] * radius
    out[k + 3] = lights[k + 3] ?? 0.5
    out[k + 4] = lights[k + 4] ?? 0.8
  }
  return out
}

/** The buffers a result can hand over rather than copy. */
export function transferables(result: WorkResult): Transferable[] {
  switch (result.kind) {
    case 'clouds':
      return [result.texture.buffer]
    case 'lights':
      return [result.lights.buffer, result.glow.buffer]
    case 'falls':
      return [result.falls.buffer]
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
        result.patch.rapids.buffer,
        result.patch.current.buffer,
        result.patch.reef.buffer,
        result.patch.farm.buffer,
        result.patch.ground.buffer,
        result.patch.water.buffer,
      ]
  }
}
