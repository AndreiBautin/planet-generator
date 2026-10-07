import type { Vec3 } from './cube'
import { FREEZES } from './features'
import { cellOf, hydrologyOf } from './hydrology'
import { surfaceAt, type Planet } from './planet'
import { settlementsOf } from './settlements'

/**
 * The world laid flat: a map of the whole planet, latitude up the side and
 * longitude across, as a navigator's chart would have it. Coloured as the
 * ground is from orbit, shaded as if lit from the north-west so the
 * mountains stand up off the page, with the rivers, the lakes and the sea
 * ice drawn on, and the towns as places to mark. Pure, and slow enough for
 * the builder worker, which is where it is made.
 */
export interface WorldMap {
  /** RGBA, `width` by half that, the first row the north. */
  readonly pixels: Uint8Array
  readonly width: number
  /** The towns, three numbers each: where across and down the map, 0 to 1, and how big, 0 to 1. */
  readonly towns: Float32Array
}

/** Where on the map a direction falls, 0 to 1 across (west to east) and down (north to south). */
export function mapPoint(direction: Vec3): readonly [number, number] {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1
  const latitude = Math.asin(Math.max(-1, Math.min(1, direction[1] / length)))
  const longitude = Math.atan2(direction[0], direction[2])
  return [longitude / (Math.PI * 2) + 0.5, 0.5 - latitude / Math.PI]
}

/** The direction under a point of the map, 0 to 1 across and down. */
export function mapDirection(across: number, down: number): Vec3 {
  const latitude = (0.5 - down) * Math.PI
  const longitude = (across - 0.5) * Math.PI * 2
  return [
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.cos(longitude),
  ]
}

/** How much more a river must gather than the wettest-but-one cell to be drawn: only the big ones. */
const RIVER_FLOW = 0.985

export function bakeMap(planet: Planet, width: number): WorldMap {
  const height = Math.round(width / 2)
  const heights = new Float32Array(width * height)
  const colours = new Float32Array(width * height * 3)
  const frozen = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const [x, y, z] = mapDirection((column + 0.5) / width, (row + 0.5) / height)
      const surface = surfaceAt(planet, x, y, z)
      const k = row * width + column
      heights[k] = surface.height
      colours.set(surface.colour, k * 3)
      if (surface.height < 0 && !planet.molten && surface.warmth < FREEZES) frozen[k] = 1
    }
  }
  // Rivers: the cells that gather the most, by the drainage map's own
  // count, so the ones drawn are the ones the ground has.
  const hydrology = planet.molten ? undefined : hydrologyOf(planet)
  let riverAt = Number.POSITIVE_INFINITY
  if (hydrology !== undefined) {
    const landFlow = Array.from(hydrology.flow).filter(
      (_, cell) => (hydrology.height[cell] ?? 0) > 0,
    )
    landFlow.sort((a, b) => a - b)
    riverAt = landFlow[Math.floor(landFlow.length * RIVER_FLOW)] ?? Number.POSITIVE_INFINITY
  }
  const pixels = new Uint8Array(width * height * 4)
  const at = (column: number, row: number): number =>
    heights[Math.min(height - 1, Math.max(0, row)) * width + ((column + width) % width)] ?? 0
  for (let row = 0; row < height; row += 1) {
    // A column of the map is narrower towards the poles, so its slope there is steeper.
    const across = Math.max(0.05, Math.cos((0.5 - (row + 0.5) / height) * Math.PI))
    for (let column = 0; column < width; column += 1) {
      const k = row * width + column
      const here = heights[k] ?? 0
      let r = colours[k * 3] ?? 0
      let g = colours[k * 3 + 1] ?? 0
      let b = colours[k * 3 + 2] ?? 0
      if (here > 0) {
        // Lit from the north-west: brighter on slopes facing it, darker away.
        const east = (at(column + 1, row) - at(column - 1, row)) / across
        const south = at(column, row + 1) - at(column, row - 1)
        const shade = Math.min(1.35, Math.max(0.55, 1 + (-east - south) * planet.relief * 14))
        r *= shade
        g *= shade
        b *= shade
      }
      if (frozen[k] === 1) {
        r = r * 0.3 + 0.62
        g = g * 0.3 + 0.68
        b = b * 0.3 + 0.72
      }
      if (hydrology !== undefined && here > 0) {
        const direction = mapDirection((column + 0.5) / width, (row + 0.5) / height)
        const cell = cellOf(direction)
        const lake = hydrology.lake[cell] ?? Number.NEGATIVE_INFINITY
        if (lake > (hydrology.height[cell] ?? 0)) {
          r = 0.14
          g = 0.3
          b = 0.46
        } else if ((hydrology.flow[cell] ?? 0) >= riverAt) {
          r = r * 0.35 + 0.08
          g = g * 0.35 + 0.22
          b = b * 0.35 + 0.42
        }
      }
      pixels[k * 4] = Math.round(Math.min(1, r) * 255)
      pixels[k * 4 + 1] = Math.round(Math.min(1, g) * 255)
      pixels[k * 4 + 2] = Math.round(Math.min(1, b) * 255)
      pixels[k * 4 + 3] = 255
    }
  }
  const settled = planet.molten ? [] : settlementsOf(planet).towns
  const towns = new Float32Array(settled.length * 3)
  settled.forEach((town, k) => {
    const [across, down] = mapPoint(town.at)
    towns.set([across, down, town.size], k * 3)
  })
  return { pixels, width, towns }
}
