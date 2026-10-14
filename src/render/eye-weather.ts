import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'

import { cloudDataOf } from './clouds'
import { DETAIL_TIME } from './detail'
import { inPlanetFrame, smooth, unit } from './frames'
import { rainbowStrength } from './rainbow'
import { flowingCoverAt } from './winds'

/**
 * The weather where the eye is, read off the same flowing cloud cover every
 * other reader uses (winds.ts): how hard it rains on the eye, and whether a
 * rainbow stands on the far side from the sun.
 */

/** Scratch, so a frame allocates nothing. */
const awayFromSun = new THREE.Vector3()
const eyeUp = new THREE.Vector3()

/**
 * How bright a rainbow is now: the sun's height over the eye, and the
 * cloud over the eye and out on the far side from the sun, where the
 * rain that makes the bow would be (rainbow.ts).
 */
export function bowFor(
  eye: THREE.Vector3,
  sunDirection: THREE.Vector3,
  clouds: THREE.Mesh,
  turn: number,
  scale: number,
): number {
  const height = eye.length() / scale - 1
  if (height > 0.08) return 0
  const held = cloudDataOf(clouds)
  if (held === undefined) return 0
  const at = unit(inPlanetFrame(eye, turn * 1.15, 1))
  const away = inPlanetFrame(awayFromSun.copy(sunDirection).negate(), turn * 1.15, 1)
  const along = away[0] * at[0] + away[1] * at[1] + away[2] * at[2]
  const out = unit([away[0] - at[0] * along, away[1] - at[1] * along, away[2] - at[2] * along])
  const cover = (d: Vec3): number => flowingCoverAt(held.data, held.width, d, DETAIL_TIME.value)
  let rainAway = 0
  for (const reach of [0.015, 0.03, 0.045, 0.06]) {
    const c = Math.cos(reach)
    const s = Math.sin(reach)
    rainAway = Math.max(
      rainAway,
      cover(unit([at[0] * c + out[0] * s, at[1] * c + out[1] * s, at[2] * c + out[2] * s])),
    )
  }
  return rainbowStrength({
    sunUp: eyeUp.copy(eye).normalize().dot(sunDirection),
    height,
    rainAway,
    cloudOver: cover(at),
  })
}

/** How heavy a shower falls on the eye: the cloud over it, only low down. */
export function rainOver(eye: THREE.Vector3, clouds: THREE.Mesh, turn: number): number {
  const above = eye.length() - 1
  if (above > 0.12) return 0
  const held = cloudDataOf(clouds)
  if (held === undefined) return 0
  // The eye's direction in the cloud layer's own frame, which turns a
  // little ahead of the ground.
  const direction = inPlanetFrame(eye, turn * 1.15, 1)
  const length = Math.hypot(...direction) || 1
  const cover = flowingCoverAt(
    held.data,
    held.width,
    [direction[0] / length, direction[1] / length, direction[2] / length],
    DETAIL_TIME.value,
  )
  return smooth(0.5, 0.8, cover) * (1 - smooth(0.06, 0.12, above))
}
