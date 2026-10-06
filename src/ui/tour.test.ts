import { describe, expect, it } from 'vitest'

import { advance, startGlide, type Ground } from './glide'
import {
  arcBetween,
  guideAltitude,
  guideStep,
  guideTurn,
  startGuide,
  stickFor,
  tourTurn,
  TOUR_TURN,
} from './tour'
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

describe('the guided tour', () => {
  const flat: Ground = () => 1.01
  const toward = (target: [number, number, number], seconds: number) => {
    let glide = startGlide([0, 0, 1], [1, 0, 0], flat)
    const dt = 1 / 30
    for (let frame = 0; frame < seconds * 30; frame += 1) {
      glide = steer(glide, stickFor(glide, guideTurn(glide, target), dt), 0, 1)
      glide = advance(glide, dt, flat)
    }
    return glide
  }

  it('turns round and flies to a target behind it', () => {
    const l = Math.hypot(-0.3, 0.2, 1)
    const target: [number, number, number] = [-0.3 / l, 0.2 / l, 1 / l]
    const start = arcBetween([0, 0, 1], target)
    const glide = toward(target, 40)
    expect(arcBetween(glide.position, target)).toBeLessThan(start / 4)
  })

  it('flies high across a distance and low to arrive', () => {
    expect(guideAltitude(1)).toBeGreaterThan(guideAltitude(0.05) * 4)
    expect(guideAltitude(0.01)).toBeLessThan(0.015)
  })

  it('names each stop once on arrival, then moves on to the next', () => {
    const here: [number, number, number] = [0, 0, 1]
    let guide = startGuide([
      { name: 'Mount A', title: '', path: [here] },
      { name: 'Lake B', title: '', path: [[1, 0, 0]] },
    ])
    const first = guideStep(guide, here, 0)
    expect(first.arrived?.name).toBe('Mount A')
    guide = first.guide
    expect(guideStep(guide, here, 1).arrived).toBeUndefined()
    const later = guideStep(guide, here, 20)
    expect(later.guide.index).toBe(1)
    // Named as it comes into view, before the eye is over it.
    // 0.04 radians short of it: in view ahead, not yet under the eye.
    const approaching = guideStep(later.guide, [Math.cos(0.04), 0, Math.sin(0.04)], 21)
    expect(approaching.arrived?.name).toBe('Lake B')
    expect(guideStep(later.guide, here, 21).target).toEqual([1, 0, 0])
  })
})
