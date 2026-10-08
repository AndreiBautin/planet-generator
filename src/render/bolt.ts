import * as THREE from 'three'

import type { Vec3 } from './patches/cube'

/**
 * The lightning bolt itself. The flash lit the cloud from inside and the
 * land for a quarter of a second with nothing drawn, so from a glide the
 * whole view brightened and dimmed for no visible reason — reported as the
 * screen flashing. A jagged channel from the cloud base to the ground
 * under the strike, with two forks, drawn additively while the flash
 * lasts, is what makes the brightening read as weather.
 *
 * A child of the cloud layer, placed in its frame as the strike is, so it
 * stands where the lit cloud is.
 */

const STEPS = 18
const FORKS = 2

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The points of one bolt, as segments (pairs of points), from `top` down to
 * `foot` (both in the layer's frame), jagged by `seed`. Pure, so a test can
 * hold that it starts and ends where it should and never wanders far.
 */
export function boltSegments(seed: number, top: Vec3, foot: Vec3): number[] {
  const out: number[] = []
  const [sx, sy, sz] = [foot[0] - top[0], foot[1] - top[1], foot[2] - top[2]]
  const length = Math.hypot(sx, sy, sz) || 1
  // Two directions square to the channel, for the jags.
  const up: Vec3 = [
    top[0] / (Math.hypot(...top) || 1),
    top[1] / (Math.hypot(...top) || 1),
    top[2] / (Math.hypot(...top) || 1),
  ]
  const side: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a: Vec3 = [
    up[1] * side[2] - up[2] * side[1],
    up[2] * side[0] - up[0] * side[2],
    up[0] * side[1] - up[1] * side[0],
  ]
  const al = Math.hypot(...a) || 1
  const e1: Vec3 = [a[0] / al, a[1] / al, a[2] / al]
  const e2: Vec3 = [
    up[1] * e1[2] - up[2] * e1[1],
    up[2] * e1[0] - up[0] * e1[2],
    up[0] * e1[1] - up[1] * e1[0],
  ]
  const wobble = length * 0.12
  const channel = (from: number, to: number, salt: number, scale: number): Vec3[] => {
    const points: Vec3[] = []
    const n = Math.max(2, Math.round(STEPS * (to - from)))
    for (let k = 0; k <= n; k += 1) {
      const t = from + ((to - from) * k) / n
      // The jag dies to nothing at both ends, so the channel meets the
      // cloud and the ground exactly.
      const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - from) / (to - from)))) * scale
      const j1 = (hash(seed * 7 + salt * 31 + k) - 0.5) * wobble * taper
      const j2 = (hash(seed * 11 + salt * 17 + k + 0.5) - 0.5) * wobble * taper
      points.push([
        top[0] + sx * t + e1[0] * j1 + e2[0] * j2,
        top[1] + sy * t + e1[1] * j1 + e2[1] * j2,
        top[2] + sz * t + e1[2] * j1 + e2[2] * j2,
      ])
    }
    return points
  }
  const push = (points: Vec3[]): void => {
    for (let k = 1; k < points.length; k += 1) {
      const p = points[k - 1]
      const q = points[k]
      if (p === undefined || q === undefined) continue
      out.push(p[0], p[1], p[2], q[0], q[1], q[2])
    }
  }
  const main = channel(0, 1, 0, 1)
  push(main)
  // Forks: off the main channel part way down, short, angled out, ending
  // in the air.
  for (let f = 0; f < FORKS; f += 1) {
    const at = Math.floor((0.2 + 0.45 * hash(seed * 3 + f)) * (main.length - 1))
    const start = main[at]
    if (start === undefined) continue
    const reach = 0.25 + 0.2 * hash(seed * 5 + f)
    const lean = (hash(seed * 13 + f) - 0.5) * wobble * 4
    const lean2 = (hash(seed * 19 + f) - 0.5) * wobble * 4
    const end: Vec3 = [
      start[0] + sx * reach + e1[0] * lean + e2[0] * lean2,
      start[1] + sy * reach + e1[1] * lean + e2[1] * lean2,
      start[2] + sz * reach + e1[2] * lean + e2[2] * lean2,
    ]
    const fork: Vec3[] = []
    const n = 6
    for (let k = 0; k <= n; k += 1) {
      const t = k / n
      const taper = Math.sin(Math.PI * t) * 0.5
      const j1 = (hash(seed * 23 + f * 41 + k) - 0.5) * wobble * taper
      const j2 = (hash(seed * 29 + f * 43 + k) - 0.5) * wobble * taper
      fork.push([
        start[0] + (end[0] - start[0]) * t + e1[0] * j1 + e2[0] * j2,
        start[1] + (end[1] - start[1]) * t + e1[1] * j1 + e2[1] * j2,
        start[2] + (end[2] - start[2]) * t + e1[2] * j1 + e2[2] * j2,
      ])
    }
    push(fork)
  }
  return out
}

export class Bolt {
  readonly object: THREE.LineSegments
  private readonly material: THREE.LineBasicMaterial
  private readonly geometry = new THREE.BufferGeometry()
  private shown = -1

  constructor() {
    this.material = new THREE.LineBasicMaterial({
      color: new THREE.Color(1.6, 1.7, 2.4),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    this.object = new THREE.LineSegments(this.geometry, this.material)
    this.object.frustumCulled = false
    this.object.visible = false
    this.object.name = 'bolt'
    this.object.renderOrder = 2
  }

  /**
   * Show the bolt of strike `strike` (a count: a new one rebuilds the
   * channel) from `top` to `foot` in the layer's frame, at `strength`
   * 0 to 1; hidden at nought.
   */
  update(strike: number, top: Vec3, foot: Vec3, strength: number): void {
    if (strength <= 0.01) {
      this.object.visible = false
      return
    }
    if (strike !== this.shown) {
      this.shown = strike
      const segments = boltSegments(strike, top, foot)
      this.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(Float32Array.from(segments), 3),
      )
      this.geometry.computeBoundingSphere()
    }
    this.material.opacity = Math.min(1, strength)
    this.object.visible = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
