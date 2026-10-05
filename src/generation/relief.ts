import { fbm, ridged } from './noise'
import { surfaceAt, type Planet, type Surface } from './planet'

/**
 * Small-scale relief: the gullies, knolls and crags that only exist close
 * up. From orbit a planet is continents and ranges; skimming over it, the
 * same ground without this reads as smooth plastic.
 *
 * Shaped by the biome, because a desert and a snowfield are not the same
 * ground with a different colour: dry lowland is drawn into long dunes
 * lying across the wind, snow into soft drifts, and everywhere else into
 * crags and grain.
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
export function fineReliefAt(
  planet: Planet,
  x: number,
  y: number,
  z: number,
  surface: Surface = surfaceAt(planet, x, y, z),
): number {
  const [ox, oy, oz] = planet.offset
  const px = x + oy
  const py = y + oz
  const pz = z + ox
  const crags = ridged(planet.fine, px * 26, py * 26, pz * 26, 4)
  const grain = fbm(planet.fine, px * 140, py * 140, pz * 140, 3) * 0.5 + 0.5
  const rough = (crags * 0.75 + grain * 0.25) * (0.5 + planet.dials.roughness)

  const dunes = duneWeight(planet, surface)
  const drifts = surface.biome === 'snow' ? 1 : 0
  if (dunes <= 0 && drifts <= 0) return rough

  let relief = rough * (1 - Math.max(dunes, drifts))
  if (dunes > 0) {
    // Ridges stretched along one direction, bent a little by a slower
    // noise so they wander as dunes do.
    const bend = fbm(planet.fine, px * 9, py * 9, pz * 9, 2) * 0.35
    const ridge = ridged(planet.fine, px * 60 + bend, py * 14, pz * 60 - bend, 2)
    const small = ridged(planet.fine, px * 210 - bend, py * 50, pz * 210 + bend, 1)
    const crest = ridge * ridge * 1.5 + small * small * 0.35
    relief += (crest + grain * 0.1) * dunes
  }
  if (drifts > 0) {
    // Long soft swells, nothing sharp: wind-packed snow.
    const swell = fbm(planet.fine, px * 38, py * 38, pz * 38, 2) * 0.5 + 0.5
    relief += (swell * 0.9 + grain * 0.08) * drifts
  }
  return relief
}

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** How much of this ground is dune: dry, hot, low — or any lowland of an arid world. */
export function duneWeight(planet: Planet, surface: Surface): number {
  if (surface.height <= 0 || planet.molten || surface.biome === 'snow') return 0
  const low = 1 - smooth(0.2, 0.45, surface.height)
  const dry =
    planet.kind === 'arid'
      ? 1 - smooth(0.6, 0.9, surface.moisture)
      : smooth(0.45, 0.8, surface.warmth) * (1 - smooth(0.3, 0.6, surface.moisture))
  return low * dry
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

/**
 * The weight for a spot of ground: the height rule, except that dunes
 * stand on low ground — a sand sea is all relief at a height where crags
 * would be nothing — so dune country carries its relief from just above
 * the shore.
 */
export function reliefWeightAt(planet: Planet, surface: Surface): number {
  const byHeight = fineReliefWeight(surface.height)
  const dunes = duneWeight(planet, surface) * smooth(0.012, 0.04, surface.height) * 0.5
  const drifts = surface.biome === 'snow' ? smooth(0.012, 0.04, surface.height) * 0.35 : 0
  return Math.max(byHeight, dunes, drifts)
}
