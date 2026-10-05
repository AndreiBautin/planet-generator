import { describe, expect, it } from 'vitest'

import {
  advance,
  MAX_ALTITUDE,
  MAX_PITCH_DOWN,
  MAX_PITCH_UP,
  MIN_ALTITUDE,
  pinchGlide,
  poseOf,
  startGlide,
  steer,
  type Ground,
  type Glide,
  type Vec3,
} from './glide'

const flat: Ground = () => 1
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2])
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const start = startGlide([0, 0, 1], [1, 0, 0], flat)

describe('gliding', () => {
  it('starts above the ground at its altitude, heading along the ground', () => {
    expect(start.eye).toBeCloseTo(1 + start.altitude, 10)
    expect(dot(start.heading, start.position)).toBeCloseTo(0, 10)
    expect(length(start.heading)).toBeCloseTo(1, 10)
  })

  it('makes a heading that points into the ground lie flat along it', () => {
    const tilted = startGlide([0, 0, 1], [0.6, 0, 0.8], flat)
    expect(dot(tilted.heading, tilted.position)).toBeCloseTo(0, 10)
    expect(tilted.heading[0]).toBeGreaterThan(0.99)
  })

  it('moves forward along its heading and stays on the sphere', () => {
    let glide = start
    for (let frame = 0; frame < 120; frame += 1) glide = advance(glide, 1 / 60, flat)
    expect(length(glide.position)).toBeCloseTo(1, 10)
    expect(dot(glide.heading, glide.position)).toBeCloseTo(0, 8)
    // Heading +x from the +z pole, so it has moved towards +x.
    expect(glide.position[0]).toBeGreaterThan(0)
    expect(Math.abs(glide.position[1])).toBeLessThan(1e-9)
  })

  it('rises before a ridge rather than into it', () => {
    // A wall of ground just ahead, in the direction of travel.
    const wall: Ground = (d) => (d[0] > 0.02 ? 1.03 : 1)
    let glide = start
    let peak = glide.eye
    for (let frame = 0; frame < 60; frame += 1) {
      glide = advance(glide, 1 / 60, wall)
      if (glide.position[0] <= 0.02) peak = glide.eye
    }
    expect(peak).toBeGreaterThan(1.02)
  })

  it('never comes closer to the ground than its clearance', () => {
    const bumpy: Ground = (d) => 1 + 0.02 * Math.abs(Math.sin(d[0] * 400))
    let glide = startGlide([0, 0, 1], [1, 0, 0], bumpy)
    for (let frame = 0; frame < 600; frame += 1) {
      glide = advance(glide, 1 / 60, bumpy)
      expect(glide.eye).toBeGreaterThan(bumpy(glide.position))
    }
  })

  it('turns with a sideways drag, over the next moments, and keeps flying along the ground', () => {
    const steered = steer(start, 200, 0, 800)
    // The stick sets a rate; the heading itself swings as it flies.
    expect(steered.heading).toEqual(start.heading)
    expect(steered.yawRate).toBeGreaterThan(0)
    let turned = steered
    for (let at = 0; at < 60; at += 1) turned = advance(turned, 1 / 60, flat)
    expect(dot(turned.heading, start.heading)).toBeLessThan(0.99)
    expect(dot(turned.heading, turned.position)).toBeCloseTo(0, 10)
    // Right is right: seen from above (+z) heading +x, a right turn goes towards −y.
    expect(turned.heading[1]).toBeLessThan(0)
  })

  it('swings about half a turn for a drag the height of the screen', () => {
    let turned = steer(start, 800, 0, 800)
    for (let at = 0; at < 60 * 6; at += 1) turned = advance(turned, 1 / 60, flat)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(turned.heading, start.heading))))
    expect(angle).toBeGreaterThan(Math.PI * 0.4)
    expect(Math.abs(turned.yawRate)).toBeLessThan(0.01)
  })

  it('banks into a turn and levels its wings again', () => {
    let turned = steer(start, 400, 0, 800)
    for (let at = 0; at < 20; at += 1) turned = advance(turned, 1 / 60, flat)
    expect(turned.roll).toBeGreaterThan(0.05)
    const pose = poseOf(turned)
    // The up of the eye leans off the vertical by the bank.
    expect(dot(pose.up, turned.position)).toBeLessThan(0.999)
    for (let at = 0; at < 60 * 6; at += 1) turned = advance(turned, 1 / 60, flat)
    expect(Math.abs(turned.roll)).toBeLessThan(0.01)
    expect(dot(poseOf(turned).up, turned.position)).toBeCloseTo(1, 3)
  })

  it('pitches up with a finger moving up, and climbs as it flies', () => {
    // Screen y grows downwards: a finger moving up asks the nose up.
    const up = steer(start, 0, -200, 800)
    expect(up.pitchGoal).toBeGreaterThan(0)
    expect(up.pitch).toBe(0)
    expect(steer(start, 0, -100_000, 800).pitchGoal).toBe(MAX_PITCH_UP)
    expect(steer(start, 0, 100_000, 800).pitchGoal).toBe(-MAX_PITCH_DOWN)
    let flown = up
    for (let at = 0; at < 60; at += 1) flown = advance(flown, 1 / 60, flat)
    expect(flown.pitch).toBeGreaterThan(0)
    expect(flown.altitude).toBeGreaterThan(start.altitude)
    let dived = steer(start, 0, 200, 800)
    for (let at = 0; at < 60; at += 1) dived = advance(dived, 1 / 60, flat)
    expect(dived.altitude).toBeLessThan(start.altitude)
  })

  it('gains speed in a dive and spends it in a climb', () => {
    let dived = steer(start, 0, 300, 800)
    for (let at = 0; at < 60; at += 1) dived = advance(dived, 1 / 60, flat)
    expect(dived.rush).toBeGreaterThan(0.1)
    expect(poseOf(dived).rush).toBeGreaterThan(0)
    let climbed = steer(dived, 0, -600, 800)
    for (let at = 0; at < 90; at += 1) climbed = advance(climbed, 1 / 60, flat)
    expect(climbed.rush).toBeLessThan(dived.rush)
    let settled = dived
    for (let at = 0; at < 60 * 15; at += 1) settled = advance(settled, 1 / 60, flat)
    expect(Math.abs(settled.rush)).toBeLessThan(0.02)
    expect(poseOf(start).rush).toBe(0)
  })

  it('levels itself again once left alone, and keeps within its ceiling and floor', () => {
    let flown = steer(start, 0, -100_000, 800)
    for (let at = 0; at < 60 * 20; at += 1) flown = advance(flown, 1 / 60, flat)
    expect(Math.abs(flown.pitch)).toBeLessThan(0.01)
    expect(flown.altitude).toBeLessThanOrEqual(MAX_ALTITUDE)
    let dived = steer(start, 0, 100_000, 800)
    for (let at = 0; at < 60 * 20; at += 1) dived = advance(dived, 1 / 60, flat)
    expect(dived.altitude).toBeGreaterThanOrEqual(MIN_ALTITUDE)
    expect(pinchGlide(start, 2).altitude).toBeLessThan(start.altitude)
    expect(pinchGlide(start, Number.NaN)).toBe(start)
  })

  it('looks up the sky when pitched up and at the ground when pitched down', () => {
    const forwardOf = (glide: Glide): Vec3 => {
      const pose = poseOf(glide)
      return [pose.look[0] - pose.eye[0], pose.look[1] - pose.eye[1], pose.look[2] - pose.eye[2]]
    }
    const after = (glide: Glide): Glide => {
      let flown = glide
      for (let at = 0; at < 30; at += 1) flown = advance(flown, 1 / 60, flat)
      return flown
    }
    const level = dot(forwardOf(after(start)), start.position)
    expect(dot(forwardOf(after(steer(start, 0, -300, 800))), start.position)).toBeGreaterThan(level)
    expect(dot(forwardOf(after(steer(start, 0, 300, 800))), start.position)).toBeLessThan(level)
  })

  it('looks ahead and a little down, with up away from the centre', () => {
    const pose = poseOf(start)
    const forward: Vec3 = [
      pose.look[0] - pose.eye[0],
      pose.look[1] - pose.eye[1],
      pose.look[2] - pose.eye[2],
    ]
    expect(dot(forward, start.heading)).toBeGreaterThan(0.9)
    expect(dot(forward, start.position)).toBeLessThan(0)
    expect(pose.up[0]).toBeCloseTo(start.position[0], 10)
    expect(pose.up[2]).toBeCloseTo(start.position[2], 10)
  })

  it('does nothing for a step of no time', () => {
    expect(advance(start, 0, flat)).toBe(start)
    expect(advance(start, Number.NaN, flat)).toBe(start)
  })
})
