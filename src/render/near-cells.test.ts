import { describe, expect, it } from 'vitest'

import type { Vec3 } from '@/generation/cube'
import { cellOf, neighboursOf } from '@/generation/hydrology'
import { around } from '@/generation/oases'

import { HELD_REACH, RINGS } from './near-cells'

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The cells held round an eye, as `NearCells` gathers them. */
function held(eye: Vec3): Set<number> {
  let wanted = new Set<number>([cellOf(eye)])
  for (let ring = 0; ring < RINGS; ring += 1) {
    const next = new Set(wanted)
    for (const k of wanted) for (const n of neighboursOf(k)) next.add(n)
    wanted = next
  }
  return wanted
}

describe('NearCells', () => {
  it('holds every cell within its reach, at the cube’s seams and corners too', () => {
    let seed = 11
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const eyes: Vec3[] = []
    for (let k = 0; k < 120; k += 1) eyes.push(unit([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]))
    // Crowded at the corners and along the edges, where two rings fell short.
    for (let k = 0; k < 60; k += 1) {
      const corner: Vec3 = [rnd() < 0.5 ? -1 : 1, rnd() < 0.5 ? -1 : 1, rnd() < 0.5 ? -1 : 1]
      eyes.push(
        unit([corner[0] + (rnd() - 0.5) * 0.15, corner[1] + (rnd() - 0.5) * 0.15, corner[2]]),
      )
      eyes.push(unit([(rnd() - 0.5) * 0.1, 1 + (rnd() - 0.5) * 0.05, corner[2]]))
    }
    for (const eye of eyes) {
      const cells = held(eye)
      for (let k = 0; k < 24; k += 1) {
        const point = around(eye, HELD_REACH, (k * Math.PI) / 12)
        expect(cells.has(cellOf(point))).toBe(true)
      }
    }
  })
})
