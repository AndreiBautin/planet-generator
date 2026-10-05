import { describe, expect, it } from 'vitest'

import {
  expeditionOver,
  fit,
  holdCapacity,
  jump,
  lacking,
  landingGate,
  MODULE_SPECS,
  MODULES,
  newShip,
  offeredWorlds,
  reachOf,
  STARTING_FUEL,
} from './expedition'

describe('the expedition', () => {
  it('offers the same three worlds for the same expedition and jump, and different ones per jump', () => {
    const first = offeredWorlds('abc', 0)
    expect(offeredWorlds('abc', 0)).toEqual(first)
    expect(new Set(first).size).toBe(3)
    expect(offeredWorlds('abc', 1)).not.toEqual(first)
    expect(offeredWorlds('xyz', 0)).not.toEqual(first)
    for (const seed of first) expect(seed).toMatch(/^[0-9a-z]{7}$/)
  })

  it('spends fuel on a jump and ends when it is gone', () => {
    let ship = newShip('abc')
    expect(ship.fuel).toBe(STARTING_FUEL)
    for (let at = 0; at < STARTING_FUEL; at += 1) {
      const next = jump(ship)
      if (next === undefined) throw new Error('fuel ran out early')
      ship = next
    }
    expect(expeditionOver(ship)).toBe(true)
    expect(jump(ship)).toBeUndefined()
    expect(ship.jumps).toBe(STARTING_FUEL)
  })

  it('gates volcanic and frozen worlds on their modules', () => {
    const ship = newShip('abc')
    expect(landingGate(ship, 'volcanic')).toBe('shield')
    expect(landingGate(ship, 'frozen')).toBe('runners')
    expect(landingGate(ship, 'temperate')).toBeUndefined()
    const shielded = { ...ship, modules: ['shield' as const] }
    expect(landingGate(shielded, 'volcanic')).toBeUndefined()
  })

  it('fits a module only when the hold can pay, and pays exactly', () => {
    const ship = newShip('abc')
    const poor = fit(ship, { wood: 3 }, 'lamps')
    expect(poor.ship).toBe(ship)
    expect(lacking({ wood: 3 }, MODULE_SPECS.lamps.cost)).toEqual({ wood: 5, sand: 8 })
    const rich = fit(ship, { wood: 10, sand: 8, stone: 1 }, 'lamps')
    expect(rich.ship.modules).toEqual(['lamps'])
    expect(rich.hold).toEqual({ wood: 2, stone: 1 })
    // Fitting it again changes nothing.
    expect(fit(rich.ship, rich.hold, 'lamps')).toEqual({ ship: rich.ship, hold: rich.hold })
  })

  it('has a spec for every module, and the modules change what the ship can do', () => {
    for (const module of MODULES)
      expect(Object.keys(MODULE_SPECS[module].cost).length).toBeGreaterThan(0)
    const ship = newShip('abc')
    expect(holdCapacity({ ...ship, modules: ['hold'] })).toBe(holdCapacity(ship) * 2)
    expect(reachOf({ ...ship, modules: ['drill'] })).toBeGreaterThan(reachOf(ship))
  })
})
