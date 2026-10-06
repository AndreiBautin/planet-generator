import { describe, expect, it } from 'vitest'

import type { Vec3 } from './glide'
import {
  clockLabel,
  directionOf,
  frameIn,
  headingOf,
  heightFrom,
  hourAt,
  shotOf,
  sliderFrom,
  turnForHour,
} from './postcard'

const SUN: Vec3 = (() => {
  const l = Math.hypot(5, 1.5, 2.5)
  return [5 / l, 1.5 / l, 2.5 / l]
})()

/** The planet's frame into the room's, as scene.ts turns it. */
const intoRoom = (p: Vec3, turn: number): Vec3 => [
  p[0] * Math.cos(turn) + p[2] * Math.sin(turn),
  p[1],
  -p[0] * Math.sin(turn) + p[2] * Math.cos(turn),
]

describe('the hour', () => {
  it('is noon where the point has been turned under the sun', () => {
    const point = directionOf(20, 40)
    const turn = turnForHour(point, SUN, 12, 0)
    const room = intoRoom(point, turn)
    // Under the sun: the same longitude as the sun in the room.
    expect(Math.atan2(room[0], room[2])).toBeCloseTo(Math.atan2(SUN[0], SUN[2]), 6)
    expect(hourAt(point, SUN, turn)).toBeCloseTo(12, 6)
  })

  it('is morning before noon as the planet turns on', () => {
    const point = directionOf(0, 0)
    const noon = turnForHour(point, SUN, 12, 0)
    expect(hourAt(point, SUN, noon - 0.3)).toBeLessThan(12)
    expect(hourAt(point, SUN, noon + 0.3)).toBeGreaterThan(12)
  })

  it('round-trips through the turn for every hour', () => {
    const point = directionOf(-35, 123)
    for (const hour of [0.5, 6, 11.75, 18.2, 23.9]) {
      expect(hourAt(point, SUN, turnForHour(point, SUN, hour, 7))).toBeCloseTo(hour, 6)
    }
  })

  it('moves the planet the short way: the turn stays near the one it had', () => {
    const point = directionOf(10, 10)
    const near = 1000
    const turn = turnForHour(point, SUN, 6, near)
    expect(Math.abs(turn - near)).toBeLessThanOrEqual(Math.PI)
  })

  it('reads as a clock', () => {
    expect(clockLabel(6 + 40 / 60)).toBe('06:40')
    expect(clockLabel(23.999)).toBe('00:00')
    expect(clockLabel(0)).toBe('00:00')
  })
})

describe('the frame', () => {
  const area = { x: 0, y: 0, width: 375, height: 500 }

  it('is the whole area, less the margin, for the screen', () => {
    expect(frameIn('screen', area, 16)).toEqual({ x: 16, y: 16, width: 343, height: 468 })
  })

  it('keeps its shape and fits inside the margin', () => {
    for (const framing of ['wide', 'tall', 'square'] as const) {
      const f = frameIn(framing, area, 16)
      expect(f.x).toBeGreaterThanOrEqual(16 - 1e-9)
      expect(f.y).toBeGreaterThanOrEqual(16 - 1e-9)
      expect(f.x + f.width).toBeLessThanOrEqual(375 - 16 + 1e-9)
      expect(f.y + f.height).toBeLessThanOrEqual(500 - 16 + 1e-9)
    }
    const wide = frameIn('wide', area, 16)
    expect(wide.width / wide.height).toBeCloseTo(1.5, 9)
    expect(wide.width).toBeCloseTo(343, 9)
    const tall = frameIn('tall', { x: 0, y: 0, width: 1400, height: 600 }, 16)
    expect(tall.width / tall.height).toBeCloseTo(0.8, 9)
    expect(tall.height).toBeCloseTo(568, 9)
  })
})

describe('the height slider', () => {
  it('runs evenly by ratio and back', () => {
    expect(heightFrom(0, 0.004, 0.12)).toBeCloseTo(0.004, 9)
    expect(heightFrom(1, 0.004, 0.12)).toBeCloseTo(0.12, 9)
    expect(heightFrom(0.5, 1, 100)).toBeCloseTo(10, 9)
    expect(sliderFrom(heightFrom(0.37, 1.9, 6), 1.9, 6)).toBeCloseTo(0.37, 9)
  })
})

describe('a viewpoint for a link', () => {
  it('round-trips a point and a heading through latitude, longitude and bearing', () => {
    const point = directionOf(23.5, -140)
    const heading = headingOf(point, 75)
    const shot = shotOf('glide', point, heading, 0.02, 9)
    expect(shot.latitude).toBeCloseTo(23.5, 9)
    expect(shot.longitude).toBeCloseTo(-140, 9)
    expect(shot.bearing).toBeCloseTo(75, 9)
    const back = headingOf(directionOf(shot.latitude, shot.longitude), shot.bearing)
    for (let k = 0; k < 3; k += 1) expect(back[k]).toBeCloseTo(heading[k] ?? 0, 9)
  })

  it('heads along the ground, and north is towards the pole', () => {
    const point = directionOf(10, 30)
    const north = headingOf(point, 0)
    expect(north[0] * point[0] + north[1] * point[1] + north[2] * point[2]).toBeCloseTo(0, 9)
    expect(north[1]).toBeGreaterThan(0)
  })
})
