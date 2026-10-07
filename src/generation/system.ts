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

/** A sister world as the sky shows it from one of its siblings. */
export interface SkyWorld {
  /** Which way to look, a unit vector in the frame `sun` is given in. */
  readonly direction: readonly [number, number, number]
  /** How bright, relative: near and big and full is bright, far and thin is faint. */
  readonly brightness: number
  readonly colour: Rgb
  readonly name: string
}

/**
 * The other worlds of a system as they stand in the sky of one of them,
 * `from`: where each is, seen from there, with the star in the direction
 * `sun`. The orbits share a plane, which holds the sun's direction and is
 * otherwise as level as it can be (it contains the horizontal square to
 * the sun); the worlds stand where their angles put them.
 *
 * Brightness goes with size squared, falls with the square of the
 * distance between and of the world's own distance from the star, and with
 * how much of its lit face is turned this way — a world beyond the star
 * is full, one between is a dark new crescent.
 */
export function skyWorlds(
  system: StarSystem,
  from: Seed,
  sun: readonly [number, number, number],
): SkyWorld[] {
  const home = system.worlds.find((world) => world.seed === from)
  if (home === undefined) return []
  const s = unitOf(sun)
  // From the star out to the home world, and square to that in the plane.
  const e1: [number, number, number] = [-s[0], -s[1], -s[2]]
  const level = unitOf([e1[2], 0, -e1[0]])
  const e2: [number, number, number] = Math.hypot(...level) > 1e-6 ? level : [1, 0, 0]
  const at = (world: SystemWorld): [number, number, number] => {
    const t = world.angle - home.angle
    return [
      world.orbit * (Math.cos(t) * e1[0] + Math.sin(t) * e2[0]),
      world.orbit * (Math.cos(t) * e1[1] + Math.sin(t) * e2[1]),
      world.orbit * (Math.cos(t) * e1[2] + Math.sin(t) * e2[2]),
    ]
  }
  const here = at(home)
  return system.worlds
    .filter((world) => world.seed !== from)
    .map((world) => {
      const there = at(world)
      const between: [number, number, number] = [
        there[0] - here[0],
        there[1] - here[1],
        there[2] - here[2],
      ]
      const apart = Math.hypot(...between) || 1
      const direction = unitOf(between)
      // Lit face turned this way: the star-to-world line against world-to-here.
      const out = unitOf(there)
      const facing =
        0.5 * (1 + (out[0] * direction[0] + out[1] * direction[1] + out[2] * direction[2]))
      const brightness =
        (world.size * world.size * (0.15 + 0.85 * facing)) /
        (apart * apart * world.orbit * world.orbit)
      return { direction, brightness, colour: world.land, name: world.name }
    })
}

function unitOf(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
