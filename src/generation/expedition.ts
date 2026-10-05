import type { PlanetKind } from './kinds'
import { hashSeed } from './rng'
import { parseSeed, SEED_ALPHABET, SEED_LENGTH, type Seed } from './seed'
import type { Block } from './voxel'

/**
 * The expedition: the rules of a run across worlds, and of the ship that
 * makes it. Pure, so the whole arc of a run — what is offered, what a
 * module costs, where the ship may land, when the fuel is gone — can be
 * tested without a screen.
 *
 * The ship is the base. It carries a hold of blocks dug from the worlds,
 * and fits modules from them; the modules decide where it can land next.
 * An expedition is a sequence of jumps, each choosing one of three worlds
 * derived from the expedition's own seed, so two players on the same
 * expedition seed are offered the same worlds in the same order.
 */
export const MODULES = ['hold', 'lamps', 'drill', 'shield', 'runners', 'scope'] as const
export type Module = (typeof MODULES)[number]

export interface ModuleSpec {
  readonly name: string
  readonly does: string
  /** Blocks it costs, by kind. */
  readonly cost: Readonly<Partial<Record<Block, number>>>
  /** Blocks it puts in the hold when fitted, by kind. */
  readonly gives?: Readonly<Partial<Record<Block, number>>>
}

export const MODULE_SPECS: Readonly<Record<Module, ModuleSpec>> = {
  hold: {
    name: 'Bigger hold',
    does: 'Carry twice as much.',
    cost: { wood: 24, stone: 12 },
  },
  lamps: {
    name: 'Lamps',
    does: 'Light the ship at night, and twelve lamps to leave on the ground.',
    cost: { wood: 8, sand: 8 },
    gives: { lamp: 12 },
  },
  drill: {
    name: 'Drill',
    does: 'Dig and build from twice as far.',
    cost: { stone: 20, basalt: 6 },
  },
  shield: {
    name: 'Heat shield',
    does: 'Land on a volcanic world.',
    cost: { basalt: 24, stone: 12 },
  },
  runners: {
    name: 'Cold runners',
    does: 'Land on a frozen world.',
    cost: { snow: 16, ice: 8, wood: 12 },
  },
  scope: {
    name: 'Surveyor scope',
    does: 'Reads warmer and colder as the ship nears what a world hides.',
    cost: { sand: 12, stone: 8, ice: 4 },
  },
}

export interface Ship {
  readonly modules: readonly Module[]
  readonly fuel: number
  /** The expedition's seed: every world offered descends from it. */
  readonly expedition: string
  /** Jumps made so far on this expedition. */
  readonly jumps: number
  /** The seeds of the worlds whose cache has been dug up. */
  readonly found: readonly string[]
}

export const STARTING_FUEL = 6
export const BASE_HOLD = 64

export const newShip = (expedition: string): Ship => ({
  modules: [],
  fuel: STARTING_FUEL,
  expedition,
  jumps: 0,
  found: [],
})

export const hasModule = (ship: Ship, module: Module): boolean => ship.modules.includes(module)

/** How many blocks the hold carries in all. */
export const holdCapacity = (ship: Ship): number =>
  hasModule(ship, 'hold') ? BASE_HOLD * 2 : BASE_HOLD

/** How far the surveyor digs and builds from, in blocks. */
export const reachOf = (ship: Ship): number => (hasModule(ship, 'drill') ? 12 : 6)

/** Whether the ship can land on a kind of world; which module it wants if not. */
export function landingGate(ship: Ship, kind: PlanetKind): Module | undefined {
  if (kind === 'volcanic' && !hasModule(ship, 'shield')) return 'shield'
  if (kind === 'frozen' && !hasModule(ship, 'runners')) return 'runners'
  return undefined
}

export type Hold = Readonly<Partial<Record<Block, number>>>

export const holdTotal = (hold: Hold): number =>
  Object.values(hold).reduce<number>((sum, count) => sum + count, 0)

/** What a cost still lacks from a hold, by kind; empty when it can be paid. */
export function lacking(hold: Hold, cost: ModuleSpec['cost']): Partial<Record<Block, number>> {
  const short: Partial<Record<Block, number>> = {}
  for (const [block, needed] of Object.entries(cost) as [Block, number][]) {
    const have = hold[block] ?? 0
    if (have < needed) short[block] = needed - have
  }
  return short
}

/** Fit a module, paying for it; the ship and hold unchanged if it cannot be paid or is already fitted. */
export function fit(
  ship: Ship,
  hold: Hold,
  module: Module,
): { readonly ship: Ship; readonly hold: Hold } {
  if (hasModule(ship, module)) return { ship, hold }
  const cost = MODULE_SPECS[module].cost
  if (Object.keys(lacking(hold, cost)).length > 0) return { ship, hold }
  const paid: Partial<Record<Block, number>> = {}
  for (const [block, have] of Object.entries(hold) as [Block, number][]) {
    const left = have - (cost[block] ?? 0)
    if (left > 0) paid[block] = left
  }
  for (const [block, count] of Object.entries(MODULE_SPECS[module].gives ?? {}) as [
    Block,
    number,
  ][]) {
    paid[block] = (paid[block] ?? 0) + count
  }
  return { ship: { ...ship, modules: [...ship.modules, module] }, hold: paid }
}

/** A seed as the link format spells it: seven characters of the seed alphabet. */
function seedFrom(word: number, salt: number): Seed {
  let text = ''
  let h = word
  for (let at = 0; at < SEED_LENGTH; at += 1) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) ^ Math.imul(salt + at + 1, 0x9e3779b1)
    text += SEED_ALPHABET[(h >>> 0) % SEED_ALPHABET.length] ?? '2'
  }
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error(`made a seed that does not parse: ${text}`)
  return parsed
}

/** The three worlds offered at a jump of an expedition: the same three for the same expedition. */
export function offeredWorlds(expedition: string, jump: number): readonly [Seed, Seed, Seed] {
  const [a, b, c] = hashSeed(`${expedition}/jump/${String(jump)}`)
  return [seedFrom(a, 1), seedFrom(b, 2), seedFrom(c, 3)]
}

/** Jump to a world: a unit of fuel, and the count. Refused with no fuel. */
export function jump(ship: Ship): Ship | undefined {
  if (ship.fuel <= 0) return undefined
  return { ...ship, fuel: ship.fuel - 1, jumps: ship.jumps + 1 }
}

export const expeditionOver = (ship: Ship): boolean => ship.fuel <= 0

/** What a cache holds: parts for the ship, and fuel for two more jumps. */
export const CACHE_PARTS: Readonly<Partial<Record<Block, number>>> = {
  stone: 12,
  basalt: 8,
  wood: 8,
  sand: 8,
  ice: 6,
  snow: 6,
}
export const CACHE_FUEL = 2

export const hasFound = (ship: Ship, world: string): boolean => ship.found.includes(world)

/** Open a world's cache: the parts into the hold, the fuel into the tank. Once per world. */
export function openCache(
  ship: Ship,
  hold: Hold,
  world: string,
): { readonly ship: Ship; readonly hold: Hold } {
  if (hasFound(ship, world)) return { ship, hold }
  const filled: Partial<Record<Block, number>> = { ...hold }
  for (const [block, count] of Object.entries(CACHE_PARTS) as [Block, number][]) {
    filled[block] = (filled[block] ?? 0) + count
  }
  return {
    ship: { ...ship, fuel: ship.fuel + CACHE_FUEL, found: [...ship.found, world] },
    hold: filled,
  }
}
