import * as THREE from 'three'

import type { Seed } from '@/generation/seed'
import { skyWorlds, type StarSystem } from '@/generation/system'

/** The most sister worlds a system has: six worlds, less the one under the eye. */
const MOST = 5

/**
 * The other worlds of the system in this one's sky (generation/system.ts,
 * `skyWorlds`): bright wandering stars in their own colours, where they
 * would stand with the sun where it is — the brightest the size of a
 * small disc, the faintest a point. Drawn round the eye at the sky's
 * distance, so the ground and the clouds hide them as they do the stars,
 * and coming out with the stars at dusk, a little before them.
 */
export class SisterWorlds {
  readonly object: THREE.Points
  private readonly positions = new Float32Array(MOST * 3)
  private readonly colours = new Float32Array(MOST * 3)
  private readonly sizes = new Float32Array(MOST)
  private readonly seen = { value: 0 }
  private system: StarSystem | undefined
  private from: Seed | undefined
  private readonly sun: [number, number, number] = [1, 0, 0]

  constructor(pixelRatio: number) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('colour', new THREE.BufferAttribute(this.colours, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
    geometry.setDrawRange(0, 0)
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { sisterSeen: this.seen, sisterPixel: { value: pixelRatio } },
      vertexShader: /* glsl */ `
        uniform float sisterPixel;
        attribute vec3 colour;
        attribute float size;
        varying vec3 vColour;
        void main() {
          vColour = colour;
          gl_PointSize = size * sisterPixel;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float sisterSeen;
        varying vec3 vColour;
        void main() {
          // A small hard disc with a soft glow round it.
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float disc = 1.0 - smoothstep(0.32, 0.42, r);
          float glow = (1.0 - smoothstep(0.0, 1.0, r)) * 0.35;
          float a = (disc + glow) * sisterSeen;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColour * a, 1.0);
        }
      `,
    })
    this.object = new THREE.Points(geometry, material)
    this.object.frustumCulled = false
    this.object.renderOrder = -1
  }

  /** The system the eye is in, and which world of it is underfoot. */
  setSystem(system: StarSystem | undefined, from: Seed): void {
    this.system = system
    this.from = from
    this.sun[0] = Number.NaN
  }

  /**
   * At the eye, at `distance` (the sky's), with the sun's direction in the
   * room, and how much of the starry sky shows (`seen`, 0 by day to 1 at
   * night): they come out a little before the stars.
   */
  update(eye: THREE.Vector3, distance: number, sun: THREE.Vector3, seen: number): void {
    this.seen.value = Math.min(1, seen * 1.4)
    this.object.visible = this.system !== undefined && this.seen.value > 0.01
    if (!this.object.visible) return
    this.object.position.copy(eye)
    this.object.scale.setScalar(distance)
    this.object.updateMatrix()
    // Only when the sun has moved (the seasons move it): the worlds stand still otherwise.
    if (this.sun[0] === sun.x && this.sun[1] === sun.y && this.sun[2] === sun.z) return
    this.sun[0] = sun.x
    this.sun[1] = sun.y
    this.sun[2] = sun.z
    const system = this.system
    const from = this.from
    if (system === undefined || from === undefined) return
    const worlds = skyWorlds(system, from, this.sun).slice(0, MOST)
    const brightest = Math.max(...worlds.map((w) => w.brightness), 1e-6)
    worlds.forEach((world, k) => {
      this.positions.set(world.direction, k * 3)
      // Relative to the brightest, but never lost: the faintest still a point.
      const glow = 0.35 + 0.65 * Math.sqrt(world.brightness / brightest)
      const [r, g, b] = world.colour
      // Pale, as a world far off is mostly its sunlit cloud.
      this.colours.set([(0.5 + r) * glow, (0.5 + g) * glow, (0.5 + b) * glow], k * 3)
      this.sizes[k] = 3 + 6 * glow * glow
    })
    const geometry = this.object.geometry
    geometry.setDrawRange(0, worlds.length)
    for (const name of ['position', 'colour', 'size']) {
      const attribute = geometry.getAttribute(name)
      attribute.needsUpdate = true
    }
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}
