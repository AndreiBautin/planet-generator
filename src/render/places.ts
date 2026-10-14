import type { Vec3 } from '@/generation/cube'
import { surfaceAt, type Planet } from '@/generation/planet'

import { unit } from './frames'

/*
 * Questions about the ground near a point, for where a glide starts and
 * what the sound hears. Pure: a planet and directions in, numbers out.
 */

/**
 * The nearest dry, raised ground to a direction that stays land for a while
 * along the heading, so a dive lands over land and the glide does not run
 * straight back out to sea over the next coast.
 */
export function landNear(planet: Planet, under: Vec3, heading: Vec3): Vec3 {
  const dry = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height > 0.04
  const solid = (d: Vec3): boolean =>
    dry(d) &&
    [0.04, 0.08, 0.12].every((k) =>
      dry(unit([d[0] + heading[0] * k, d[1] + heading[1] * k, d[2] + heading[2] * k])),
    )
  if (solid(under)) return under
  // A small island world may have no land that runs on ahead: then the
  // nearest dry ground at all, rather than the open sea.
  let nearestDry: Vec3 | undefined = dry(under) ? under : undefined
  const polar = Math.abs(under[1]) > 0.99
  const east = unit(polar ? [1, 0, 0] : [under[2], 0, -under[0]])
  const north: Vec3 = [
    under[1] * east[2] - under[2] * east[1],
    under[2] * east[0] - under[0] * east[2],
    under[0] * east[1] - under[1] * east[0],
  ]
  for (let ring = 1; ring <= 40; ring += 1) {
    const radius = ring * 0.012
    const steps = 6 + ring * 4
    for (let step = 0; step < steps; step += 1) {
      const turn = (step / steps) * Math.PI * 2
      const candidate = unit([
        under[0] + (east[0] * Math.cos(turn) + north[0] * Math.sin(turn)) * radius,
        under[1] + (east[1] * Math.cos(turn) + north[1] * Math.sin(turn)) * radius,
        under[2] + (east[2] * Math.cos(turn) + north[2] * Math.sin(turn)) * radius,
      ])
      if (solid(candidate)) return candidate
      if (nearestDry === undefined && dry(candidate)) nearestDry = candidate
    }
  }
  return nearestDry ?? under
}

/**
 * Which way to set off: the bearing with the longest run of land ahead,
 * out of sixteen, the one nearest the way the eye faced winning a tie. A
 * glide flies straight unless steered — it once leaned towards land on its
 * own, and that read as turning for no reason — so where it starts heading
 * decides whether the first minute is over ground or over open sea.
 */
export function alongTheLand(planet: Planet, position: Vec3, facing: Vec3): Vec3 {
  const dry = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height > 0
  const along = (v: Vec3): Vec3 => {
    const k = v[0] * position[0] + v[1] * position[1] + v[2] * position[2]
    return unit([v[0] - position[0] * k, v[1] - position[1] * k, v[2] - position[2] * k])
  }
  const ahead = along(facing)
  const side: Vec3 = [
    position[1] * ahead[2] - position[2] * ahead[1],
    position[2] * ahead[0] - position[0] * ahead[2],
    position[0] * ahead[1] - position[1] * ahead[0],
  ]
  let best = ahead
  let bestRun = -1
  for (let k = 0; k < 16; k += 1) {
    // Out from straight ahead in both directions alternately, so a tie keeps
    // the bearing nearest the way the eye faced.
    const turn = (Math.ceil(k / 2) * (k % 2 === 0 ? 1 : -1) * Math.PI) / 8
    const bearing: Vec3 = [
      ahead[0] * Math.cos(turn) + side[0] * Math.sin(turn),
      ahead[1] * Math.cos(turn) + side[1] * Math.sin(turn),
      ahead[2] * Math.cos(turn) + side[2] * Math.sin(turn),
    ]
    let run = 0
    while (run < 40) {
      const t = (run + 1) * 0.006
      const step = unit([
        position[0] * Math.cos(t) + bearing[0] * Math.sin(t),
        position[1] * Math.cos(t) + bearing[1] * Math.sin(t),
        position[2] * Math.cos(t) + bearing[2] * Math.sin(t),
      ])
      if (!dry(step)) break
      run += 1
    }
    if (run > bestRun) {
      best = bearing
      bestRun = run
    }
  }
  return best
}

/** How much of the ground round a point is coast, 0 to 1: sea and land both within a short way. */
export function coastAround(world: Planet, eye: Vec3): number {
  const length = Math.hypot(...eye) || 1
  const u: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
  const side: Vec3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a: Vec3 = [
    u[1] * side[2] - u[2] * side[1],
    u[2] * side[0] - u[0] * side[2],
    u[0] * side[1] - u[1] * side[0],
  ]
  const al = Math.hypot(...a) || 1
  const e1: Vec3 = [a[0] / al, a[1] / al, a[2] / al]
  const e2: Vec3 = [
    u[1] * e1[2] - u[2] * e1[1],
    u[2] * e1[0] - u[0] * e1[2],
    u[0] * e1[1] - u[1] * e1[0],
  ]
  let sea = 0
  const samples = 9
  for (let k = 0; k < samples; k += 1) {
    const reach = k === 0 ? 0 : 0.012
    const angle = (k / (samples - 1)) * Math.PI * 2
    const x = u[0] + (e1[0] * Math.cos(angle) + e2[0] * Math.sin(angle)) * reach
    const y = u[1] + (e1[1] * Math.cos(angle) + e2[1] * Math.sin(angle)) * reach
    const z = u[2] + (e1[2] * Math.cos(angle) + e2[2] * Math.sin(angle)) * reach
    if (surfaceAt(world, x, y, z).height < 0) sea += 1
  }
  const share = sea / samples
  return Math.min(1, share * (1 - share) * 4)
}
