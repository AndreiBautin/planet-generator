import { KINDS, type PlanetKind, type Rgb } from './kinds'
import { planetName } from './name'
import { createPlanet } from './planet'
import { createRng } from './rng'
import { newSeed, type Seed } from './seed'

/**
 * A planet's star system: its star and the worlds round it, decided by one
 * seed, the system's home. The home is itself one of the worlds; the others
 * have seeds of their own, derived from the home's, so each is a whole
 * planet that can be opened and flown — and a link to one names the home
 * it came from (`sys=`), so every member of a system opens the same system.
 *
 * Without a home named, a planet is the home of its own system: every seed
 * has one, and none is shared by accident.
 */
export interface SystemWorld {
  readonly seed: Seed
  readonly name: string
  readonly kind: PlanetKind
  /** How far out it orbits, 1 the innermost world's distance. */
  readonly orbit: number
  /** Where round its orbit it stands now, radians. */
  readonly angle: number
  /** Drawn size, relative: worlds are not all one size. */
  readonly size: number
  /** Its sea and its land, for drawing it small. */
  readonly sea: Rgb
  readonly land: Rgb
}

export interface StarSystem {
  readonly home: Seed
  readonly star: { readonly name: string; readonly colour: Rgb }
  /** Innermost first. */
  readonly worlds: readonly SystemWorld[]
}

/** The colours a star is drawn in, from orange dwarfs to white. */
const STAR_COLOURS: readonly Rgb[] = [
  [1, 0.72, 0.42],
  [1, 0.84, 0.6],
  [1, 0.93, 0.8],
  [0.92, 0.95, 1],
]

export function systemOf(home: Seed): StarSystem {
  const rng = createRng(home).fork('system')
  const count = 3 + Math.floor(rng.next() * 4)
  // The home's place among its siblings: anywhere but alone at the edge.
  const homeAt = Math.floor(rng.next() * count)
  const worlds: SystemWorld[] = []
  let orbit = 1
  for (let k = 0; k < count; k += 1) {
    const own = rng.fork(`world-${String(k)}`)
    const seed =
      k === homeAt
        ? home
        : newSeed((bytes) => {
            for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(own.next() * 256)
          })
    const planet = createPlanet(seed)
    const palette = KINDS[planet.kind].palette
    worlds.push({
      seed,
      name: planet.name,
      kind: planet.kind,
      orbit,
      angle: own.next() * Math.PI * 2,
      size: 0.7 + own.next() * 0.6,
      sea: palette.deep,
      land: palette.lush,
    })
    // Each orbit further out than the last by a ratio, as real ones are.
    orbit *= 1.45 + own.next() * 0.5
  }
  return {
    home,
    star: {
      name: planetName(rng.fork('star')),
      colour: STAR_COLOURS[Math.floor(rng.next() * STAR_COLOURS.length)] ?? [1, 0.9, 0.7],
    },
    worlds,
  }
}
