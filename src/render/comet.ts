import * as THREE from 'three'

import { cometInSky, cometOf, type Comet } from '@/generation/comet'
import type { Vec3 } from '@/generation/cube'
import type { Seed } from '@/generation/seed'

import { DETAIL_TIME } from './detail'

/** Steps along each tail. */
const STEPS = 48

/**
 * A great comet in the sky (generation/comet.ts): a bright head with a soft
 * coma, a broad pale dust tail curling a little off the straight, and a
 * longer, thinner blue ion tail running dead straight away from the sun,
 * its streamers drifting slowly outwards. Drawn round the eye at the
 * sky's distance, as the sister worlds are, so the ground and the clouds
 * hide it; out with the stars at dusk, and a little before them, since a
 * great comet is brighter than any star. It stands still among the stars
 * and moves with the sun only as the seasons move it.
 */
export class CometSky {
  readonly group = new THREE.Group()
  private readonly tails: THREE.Mesh
  private readonly head: THREE.Points
  private readonly seen = { value: 0 }
  private comet: Comet | undefined
  private readonly sun: [number, number, number] = [Number.NaN, 0, 0]

  constructor(pixelRatio: number) {
    // Two ribbons: along 0 at the head to 1 at the tip, across -1 to 1, and
    // which tail (0 dust, 1 ion). Positions are filled when the sun is known.
    const count = 2 * (STEPS + 1) * 2
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const strip = new Float32Array(count * 3)
    const index: number[] = []
    for (let tail = 0; tail < 2; tail += 1) {
      for (let k = 0; k <= STEPS; k += 1) {
        for (let side = 0; side < 2; side += 1) {
          const v = (tail * (STEPS + 1) + k) * 2 + side
          strip.set([k / STEPS, side * 2 - 1, tail], v * 3)
        }
        if (k < STEPS) {
          const v = (tail * (STEPS + 1) + k) * 2
          index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
        }
      }
    }
    geometry.setAttribute('strip', new THREE.BufferAttribute(strip, 3))
    geometry.setIndex(index)
    this.tails = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { cometSeen: this.seen, cometTime: DETAIL_TIME },
        vertexShader: /* glsl */ `
          attribute vec3 strip;
          varying vec3 vStrip;
          void main() {
            vStrip = strip;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float cometSeen;
          uniform float cometTime;
          varying vec3 vStrip;
          void main() {
            float along = vStrip.x;
            float across = vStrip.y;
            float ion = vStrip.z;
            // Brightest by the head, fading to nothing at the tip; soft at
            // the edges, the ion tail a narrow core.
            // Clamped: interpolated across a triangle, \`along\` runs a hair
            // past 1 at the tip, and pow of a negative is NaN. The tail is
            // drawn first, and blending carried that NaN through everything
            // drawn over it — the whole frame went black under a comet.
            float length = pow(max(1.0 - along, 0.0), mix(1.3, 0.9, ion)) * smoothstep(0.0, 0.04, along);
            float width = exp(-across * across * mix(2.6, 6.0, ion));
            // Streamers in the ion tail, drifting outwards; the dust tail
            // brighter along its leading edge, as a curved dust tail is.
            float streams = 0.62 + 0.38 * sin(across * 9.0 + along * 3.0) * sin(along * 26.0 - cometTime * 0.35 + across * 4.0);
            float edge = 0.75 + 0.25 * across;
            float glow = length * width * mix(edge * 0.55, streams * 0.42, ion);
            vec3 colour = mix(vec3(1.0, 0.93, 0.78), vec3(0.5, 0.72, 1.0), ion);
            gl_FragColor = vec4(colour * glow * cometSeen, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    const headGeometry = new THREE.BufferGeometry()
    headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
    this.head = new THREE.Points(
      headGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { cometSeen: this.seen, cometPixel: { value: pixelRatio } },
        vertexShader: /* glsl */ `
          uniform float cometPixel;
          void main() {
            gl_PointSize = 26.0 * cometPixel;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float cometSeen;
          void main() {
            // A hard bright nucleus in a soft green-white coma.
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float core = 1.0 - smoothstep(0.08, 0.16, r);
            float coma = exp(-r * r * 7.0) * 0.55;
            vec3 colour = vec3(1.0, 0.98, 0.92) * core + vec3(0.78, 0.95, 0.85) * coma;
            gl_FragColor = vec4(colour * cometSeen, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    for (const part of [this.tails, this.head]) {
      part.frustumCulled = false
      part.renderOrder = -1
    }
    this.group.add(this.tails, this.head)
    this.group.visible = false
  }

  /** A world's own sky: a comet in it, or none. */
  setWorld(seed: Seed): void {
    this.comet = cometOf(seed)
    this.sun[0] = Number.NaN
  }

  /**
   * At the eye, at `distance` (the sky's), with the sun's direction in the
   * room, and how much of the starry sky shows (`seen`, 0 by day to 1 at
   * night).
   */
  update(eye: THREE.Vector3, distance: number, sun: THREE.Vector3, seen: number): void {
    this.seen.value = Math.min(1, seen * 1.3)
    const comet = this.comet
    this.group.visible = comet !== undefined && this.seen.value > 0.01
    if (comet === undefined || !this.group.visible) return
    this.group.position.copy(eye)
    this.group.scale.setScalar(distance)
    // Only when the sun has moved: the comet stands still among the stars otherwise.
    if (this.sun[0] === sun.x && this.sun[1] === sun.y && this.sun[2] === sun.z) return
    this.sun[0] = sun.x
    this.sun[1] = sun.y
    this.sun[2] = sun.z
    const { head, tail } = cometInSky(comet, this.sun)
    const headPosition = this.head.geometry.getAttribute('position')
    headPosition.setXYZ(0, ...head)
    headPosition.needsUpdate = true
    this.lay(comet, head, tail)
  }

  /** Lay both tails out across the sky from the head. */
  private lay(comet: Comet, head: Vec3, tail: Vec3): void {
    const position = this.tails.geometry.getAttribute('position')
    // Square to both: the way the dust tail curls.
    const aside: Vec3 = [
      head[1] * tail[2] - head[2] * tail[1],
      head[2] * tail[0] - head[0] * tail[2],
      head[0] * tail[1] - head[1] * tail[0],
    ]
    for (let which = 0; which < 2; which += 1) {
      const ion = which === 1
      const length = comet.length * (ion ? 1.25 : 1)
      const centreAt = (t: number): Vec3 => {
        const a = t * length
        const curl = ion ? 0 : comet.curl * t * t * length * 0.35
        return unit([
          head[0] * Math.cos(a) + tail[0] * Math.sin(a) + aside[0] * curl,
          head[1] * Math.cos(a) + tail[1] * Math.sin(a) + aside[1] * curl,
          head[2] * Math.cos(a) + tail[2] * Math.sin(a) + aside[2] * curl,
        ])
      }
      for (let k = 0; k <= STEPS; k += 1) {
        const t = k / STEPS
        const here = centreAt(t)
        const next = centreAt(Math.min(1, t + 1 / STEPS) + (k === STEPS ? 1e-3 : 0))
        const way: Vec3 = [next[0] - here[0], next[1] - here[1], next[2] - here[2]]
        const across = unit([
          here[1] * way[2] - here[2] * way[1],
          here[2] * way[0] - here[0] * way[2],
          here[0] * way[1] - here[1] * way[0],
        ])
        // Fanning out from the head: the dust broad, the ion tail narrow.
        const half = length * (ion ? 0.006 + 0.03 * t : 0.012 + 0.12 * t)
        for (let side = 0; side < 2; side += 1) {
          const s = (side * 2 - 1) * half
          position.setXYZ(
            (which * (STEPS + 1) + k) * 2 + side,
            here[0] + across[0] * s,
            here[1] + across[1] * s,
            here[2] + across[2] * s,
          )
        }
      }
    }
    position.needsUpdate = true
  }

  dispose(): void {
    for (const part of [this.tails, this.head]) {
      part.geometry.dispose()
      const material: unknown = part.material
      if (material instanceof THREE.Material) material.dispose()
    }
  }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
