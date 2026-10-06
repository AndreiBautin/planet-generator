import * as THREE from 'three'

import { DETAIL_TIME } from './detail'
import { SEA_RADIUS } from './water'

/**
 * Under the sea: what changes when the eye goes below the surface. The
 * flight itself is the rig's (`submerge`); here is what it sees.
 *
 * - The air's haze becomes the water's: teal, dense, a few hundredths of
 *   a radius to see through, lit by the day above (`waterFog`).
 * - The sky, the clouds, the moons and everything in the air are gone.
 * - The surface is seen from below as a bright, moving ceiling.
 * - Light through the waves draws caustics on the sea bed (detail.ts).
 * - Specks drift in the water round the eye, so it has a body (`MarineSnow`).
 */

/** How far under the eye is, 0 in the air to 1 just under the surface: from its distance from the centre, in radii. */
export function underwaterAt(radius: number): number {
  const t = Math.min(1, Math.max(0, (SEA_RADIUS + 0.0002 - radius) / 0.0006))
  return t * t * (3 - 2 * t)
}

/** How dense the water's haze is, per radius: a sea bed a hundredth and a half of a radius away is about half gone. */
export const WATER_FOG_DENSITY = 45

const DEEP = new THREE.Color(0.012, 0.1, 0.13)
const SHALLOW = new THREE.Color(0.05, 0.32, 0.36)

/**
 * The water's colour seen through, into `into`: paler near the surface,
 * deeper further down, and dim at night, `day` 0 to 1.
 */
export function waterFog(depth: number, day: number, into: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, depth / 0.02))
  return into
    .copy(SHALLOW)
    .lerp(DEEP, t)
    .multiplyScalar(0.08 + 0.92 * day)
}

/** Specks in the box round the eye, in radii. */
const SPECKS = 600
const REACH = 0.004

/**
 * Marine snow: specks hanging in the water round the eye, sinking slowly
 * and swaying, the Embers' arrangement (volcanic.ts) the other way up and
 * a great deal slower. What makes the water a body the eye moves through,
 * rather than a tint.
 */
export class MarineSnow {
  readonly object: THREE.Points
  private readonly strength = { value: 0 }
  private readonly light = { value: new THREE.Color(1, 1, 1) }
  private readonly up = new THREE.Vector3()
  private static readonly Y = new THREE.Vector3(0, 1, 0)

  constructor() {
    const seeds = new Float32Array(SPECKS * 3)
    let h = 4242
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    for (let k = 0; k < SPECKS; k += 1) {
      seeds[k * 3] = next() * 2 - 1
      seeds[k * 3 + 1] = next()
      seeds[k * 3 + 2] = next() * 2 - 1
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { snowTime: DETAIL_TIME, snowStrength: this.strength, snowLight: this.light },
      vertexShader: /* glsl */ `
        uniform float snowTime;
        uniform float snowStrength;
        varying float vSeen;
        void main() {
          float sink = fract(position.y - snowTime * (0.004 + fract(position.x * 13.7) * 0.006));
          float sway = sin(snowTime * 0.4 + position.z * 20.0) * 0.00015;
          vec3 local = vec3(position.x * ${REACH.toFixed(4)} + sway, (sink - 0.5) * ${(REACH * 2).toFixed(4)}, position.z * ${REACH.toFixed(4)});
          vec4 view = modelViewMatrix * vec4(local, 1.0);
          float edge = 1.0 - smoothstep(0.55, 1.0, length(position.xz));
          vSeen = edge * snowStrength * (1.0 - smoothstep(0.15, 0.5, abs(sink - 0.5) * 1.0));
          gl_PointSize = clamp(0.00045 / max(-view.z, 1e-5) * 300.0, 1.0, 4.0);
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 snowLight;
        varying float vSeen;
        void main() {
          float spot = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
          if (spot * vSeen < 0.01) discard;
          gl_FragColor = vec4(snowLight, spot * vSeen * 0.55);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.object = new THREE.Points(geometry, material)
    this.object.frustumCulled = false
    this.object.renderOrder = 3
    this.object.visible = false
  }

  /** At the eye, as strongly as it is under (0 to 1), lit like the water round it. */
  update(eye: THREE.Vector3, under: number, water: THREE.Color, scale: number): void {
    this.strength.value = under
    this.object.visible = under > 0.01
    if (!this.object.visible) return
    this.light.value.copy(water).multiplyScalar(3).addScalar(0.08)
    this.object.position.copy(eye)
    this.object.scale.setScalar(scale)
    this.up.copy(eye).normalize()
    this.object.quaternion.setFromUnitVectors(MarineSnow.Y, this.up)
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}
