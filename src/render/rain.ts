import * as THREE from 'three'

import { DETAIL_TIME } from './detail'

/**
 * Rain: a shower of streaks around the eye, falling along the planet's up,
 * drawn only where the cloud over the eye is heavy. One set of lines whose
 * fall is a function of time in the vertex shader, so nothing is moved on
 * the page frame by frame; the whole thing is placed at the eye and turned
 * to the local up once a frame.
 *
 * It is weather you fly through, not weather you see from orbit: the box
 * is a few hundredths of a radius across and the streaks fade with the
 * cover, so a clear sky has none and a grey one has a downpour.
 */
const STREAKS = 1600
/** Half the box the streaks fall in, in planet radii. */
const RADIUS = 0.006
const HEIGHT = 0.012

export class Rain {
  readonly object: THREE.LineSegments
  private readonly strength: { value: number }
  private readonly snow = { value: 0 }
  private readonly up = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private static readonly Y = new THREE.Vector3(0, 1, 0)

  constructor() {
    const seeds = new Float32Array(STREAKS * 2 * 3)
    const tails = new Float32Array(STREAKS * 2)
    let h = 12345
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    for (let at = 0; at < STREAKS; at += 1) {
      const x = next() * 2 - 1
      const y = next()
      const z = next() * 2 - 1
      for (const end of [0, 1]) {
        const v = at * 2 + end
        seeds[v * 3] = x
        seeds[v * 3 + 1] = y
        seeds[v * 3 + 2] = z
        tails[v] = end
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
    geometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HEIGHT)
    this.strength = { value: 0 }
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        rainTime: DETAIL_TIME,
        rainStrength: this.strength,
        rainSnow: this.snow,
      },
      vertexShader: /* glsl */ `
        uniform float rainTime;
        uniform float rainStrength;
        uniform float rainSnow;
        attribute float tail;
        varying float vSnow;
        varying float vFade;
        void main() {
          // Each streak falls its own column at its own pace, wrapping
          // round the box; the tail end trails a little above the head.
          // Snow falls a fifth as fast, in short flakes rather than
          // streaks, and drifts from side to side as it comes down.
          float pace = (0.55 + fract(position.x * 7.31 + position.z * 3.17) * 0.35) * mix(1.0, 0.18, rainSnow);
          float drop = fract(position.y - rainTime * pace);
          float y = (0.5 - drop) * ${HEIGHT.toFixed(4)} + tail * ${(HEIGHT * 0.05).toFixed(5)} * mix(1.0, 0.08, rainSnow);
          float sway = sin(rainTime * 1.3 + position.z * 20.0 + position.y * 9.0) * 0.0005 * rainSnow;
          vec3 local = vec3(position.x * ${RADIUS.toFixed(4)} + sway, y, position.z * ${RADIUS.toFixed(4)} + sway * 0.6);
          vSnow = rainSnow;
          vec4 view = modelViewMatrix * vec4(local, 1.0);
          // Fainter at the tail and at the edge of the box.
          float edge = 1.0 - smoothstep(0.6, 1.0, length(position.xz));
          vFade = (1.0 - tail * 0.8) * edge * rainStrength;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vFade;
        varying float vSnow;
        void main() {
          gl_FragColor = vec4(mix(vec3(0.52, 0.6, 0.74), vec3(0.95), vSnow), vFade * mix(0.45, 0.85, vSnow));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.object = new THREE.LineSegments(geometry, material)
    this.object.frustumCulled = false
    this.object.renderOrder = 3
    this.object.visible = false
  }

  /** Whether what falls is snow rather than rain. */
  snows(snow: boolean): void {
    this.snow.value = snow ? 1 : 0
  }

  /** Place the shower at the eye, falling along `up`, as heavy as `strength` (0 to 1). */
  update(eye: THREE.Vector3, strength: number): void {
    this.strength.value = strength
    this.object.visible = strength > 0.01
    if (!this.object.visible) return
    this.object.position.copy(eye)
    this.up.copy(eye).normalize()
    this.quaternion.setFromUnitVectors(Rain.Y, this.up)
    this.object.quaternion.copy(this.quaternion)
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}

/** How heavy the cloud is over a point, as the map was baked: kept with the winds that carry it. */
export { coverAt } from './winds'
