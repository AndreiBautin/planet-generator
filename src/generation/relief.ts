import { fbm, ridged } from './noise'
import type { Planet } from './planet'

/**
 * Small-scale relief: the gullies, knolls and crags that only exist close
 * up. From orbit a planet is continents and ranges; skimming over it, the
 * same ground without this reads as smooth plastic.
 *
 * Kept apart from `surfaceAt` on purpose, and the reason is the seed
 * promise. Every link already shared is pinned by `surfaceAt`'s numbers, so
 * folding this into it would move every planet a little. Instead it is an
 * addition the renderer makes to the ground it draws, from its own noise on
 * its own fork — the coastline, the biomes and every pinned height stay
 * exactly where they were.
 *
 * Returned in the same units as a surface height, around 0 to 1.
 */
export function fineReliefAt(planet: Planet, x: number, y: number, z: number): number {
  const [ox, oy, oz] = planet.offset
  const px = x + oy
  const py = y + oz
  const pz = z + ox
  const crags = ridged(planet.fine, px * 26, py * 26, pz * 26, 4)
  const grain = fbm(planet.fine, px * 140, py * 140, pz * 140, 3) * 0.5 + 0.5
  return (crags * 0.75 + grain * 0.25) * (0.5 + planet.dials.roughness)
}

/**
 * How much of the fine relief a height of ground carries: none at the
 * shore, so the coastline does not move, rising inland and highest in the
 * mountains, where crags belong.
 */
export function fineReliefWeight(height: number): number {
  if (height <= 0.02) return 0
  return Math.min(1, (height - 0.02) / 0.15) * (0.35 + Math.min(1, height) * 0.65)
}
