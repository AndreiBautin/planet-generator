import { describe, expect, it } from 'vitest'

import { advance, startGlide, type Ground } from './glide'
import { stickFor, tourTurn, TOUR_TURN } from './tour'
import { steer } from './glide'

const SEA = 1.0015
/** Land south of the equator (y below nought), sea north of it. */
const halfLand: Ground = (d) => (d[1] < 0 ? 1.01 : 1.0)
const allLand: Ground = () => 1.01

describe('tourTurn', () => {
  it('turns towards land on one side, whichever side it is', () => {
    // Heading east along the equator: land on the right (south).
    const glide = startGlide([0, 0.02, 1], [1, 0, 0], halfLand)
    expect(tourTurn(glide, halfLand, SEA, 0)).toBeGreaterThan(0.1)
    // Heading west: the land is now on the left.
    const back = startGlide([0, 0.02, 1], [-1, 0, 0], halfLand)
    expect(tourTurn(back, halfLand, SEA, 0)).toBeLessThan(-0.1)
  })

  it('never asks for more than a gentle turn, and wanders where it is land all round', () => {
    const glide = startGlide([0, 0, 1], [1, 0, 0], allLand)
    const turns = [0, 10, 20, 30, 40].map((t) => tourTurn(glide, allLand, SEA, t))
    for (const turn of turns) expect(Math.abs(turn)).toBeLessThanOrEqual(TOUR_TURN)
    expect(new Set(turns.map((t) => t.toFixed(3))).size).toBeGreaterThan(2)
  })

  it('flown, ends up over land when it starts over the sea beside a coast', () => {
    let glide = startGlide([0, 0.03, 1], [1, 0, 0], halfLand)
    const dt = 1 / 30
    for (let frame = 0; frame < 30 * 12; frame += 1) {
      const rate = tourTurn(glide, halfLand, SEA, frame * dt)
      glide = steer(glide, stickFor(glide, rate, dt), 0, 1)
      glide = advance(glide, dt, halfLand)
    }
    expect(glide.position[1]).toBeLessThan(0)
  })
})
