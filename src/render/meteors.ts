import * as THREE from 'three'

import { createRng } from '@/generation/rng'
import type { Seed } from '@/generation/seed'

import { DETAIL_TIME } from './detail'

/** Streaks that can be in the sky at once; each one waits its turn and burns. */
const STREAKS = 32
/**
 * How far off the streaks are drawn, in radii: past the horizon seen from
 * a glide, so a ridge or a cloud in front of one hides it as it would.
 */
const DISTANCE = 0.3

/**
 * Shooting stars: a streak now and then across the night sky, when the
 * eye is low on the dark side — a bright head and a fading tail, gone in a
 * second. Each of a handful of streaks waits a while, burns, and waits
 * again, somewhere new each time; all of it a function of time in the
 * vertex shader, so nothing moves on the page frame by frame.
 *
 * Some worlds are passing through a shower: streaks come several times as
 * often, all fleeing one point of the sky, the radiant, as they do.
 *
 * Drawn round the eye at a fixed distance beyond the horizon, so whatever
 * stands in front of one hides it. Quads that face either way, since which
 * face a streak turns to the eye depends on which way it runs.
 */
export class Meteors {
  readonly object: THREE.Mesh
  private readonly dark = { value: 0 }
  private readonly up = { value: new THREE.Vector3(0, 1, 0) }
  private readonly reach = { value: DISTANCE }
  /** xyz the radiant, w 1 in a shower and 0 otherwise. */
  private readonly radiant = { value: new THREE.Vector4(0, 1, 0, 0) }

  constructor() {
    // Each streak a quad: along it 0 at the tail and 1 at the head, across
    // it either side.
    const corners: number[] = []
    const index: number[] = []
    for (let k = 0; k < STREAKS; k += 1) {
      const seed = (k + 0.5) / STREAKS
      corners.push(seed, 0, -1, seed, 0, 1, seed, 1, -1, seed, 1, 1)
      const v = k * 4
      index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('meteor', new THREE.BufferAttribute(new Float32Array(corners), 3))
    // Three needs a position to count the vertices by; the shader makes its own.
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(STREAKS * 4 * 3), 3),
    )
    geometry.setIndex(index)
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // Which face a streak turns to the eye depends on which way it runs.
      side: THREE.DoubleSide,
      uniforms: {
        meteorTime: DETAIL_TIME,
        meteorDark: this.dark,
        meteorUp: this.up,
        meteorReach: this.reach,
        meteorRadiant: this.radiant,
      },
      vertexShader: /* glsl */ `
        uniform float meteorTime;
        uniform float meteorDark;
        uniform vec3 meteorUp;
        uniform float meteorReach;
        uniform vec4 meteorRadiant;
        attribute vec3 meteor;
        varying float vGlow;
        varying float vAlong;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float seed = meteor.x * 97.0;
          float shower = meteorRadiant.w;
          // Waiting, then burning for under a second, then waiting again.
          float period = mix(14.0, 40.0, hash(seed * 3.1)) * mix(1.0, 0.3, shower);
          float t = meteorTime + hash(seed * 7.7) * period;
          float cycle = floor(t / period);
          float age = t - cycle * period;
          float life = mix(0.45, 1.1, hash(seed + cycle * 1.37));
          float k = seed * 17.0 + cycle * 3.7;
          // Somewhere new each time, any way round, most of them low: a
          // glide looks along the ground, and sees the sky only up to
          // about ten degrees over the horizon.
          vec3 up = meteorUp;
          vec3 east = normalize(cross(abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), up));
          vec3 north = cross(up, east);
          float around = hash(k + 1.0) * 6.2831853;
          float high = mix(0.04, 1.0, pow(hash(k + 2.0), 2.5));
          vec3 start = normalize(up * sin(high) + (east * cos(around) + north * sin(around)) * cos(high));
          // Across the sky any way, a little downward; in a shower straight
          // away from the radiant.
          float heading = hash(k + 3.0) * 6.2831853;
          vec3 side1 = normalize(cross(start, up) + vec3(1e-4, 0.0, 0.0));
          vec3 side2 = cross(start, side1);
          vec3 way = cos(heading) * side1 + sin(heading) * side2;
          vec3 away = start - meteorRadiant.xyz * dot(start, meteorRadiant.xyz);
          way = normalize(mix(way, normalize(away + vec3(1e-4)), shower) - up * 0.25);
          float done = clamp(age / life, 0.0, 1.0);
          float run = mix(0.12, 0.3, hash(k + 4.0));
          vec3 head = normalize(start + way * done * run);
          vec3 tail = normalize(start + way * max(0.0, done * run - 0.08));
          vec3 at = mix(tail, head, meteor.y);
          vec3 across = normalize(cross(way, at));
          float width = meteorReach * mix(0.001, 0.0028, meteor.y);
          vec3 world = cameraPosition + at * meteorReach + across * meteor.z * width;
          // Flaring up and burning out; brightest at the head; fading into
          // the haze along the horizon.
          float burning = age < life ? sin(done * 3.1415927) : 0.0;
          float clear = smoothstep(0.0, 0.08, dot(at, up));
          vGlow = burning * meteorDark * clear * mix(0.7, 1.3, hash(k + 5.0));
          vAlong = meteor.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          if (vGlow < 0.005) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        varying float vAlong;
        void main() {
          // White hot at the head, green-blue down the fading tail.
          vec3 colour = mix(vec3(0.45, 0.9, 0.75), vec3(1.0, 0.97, 0.88), vAlong * vAlong);
          gl_FragColor = vec4(colour * vGlow * vAlong * 1.8, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.object = new THREE.Mesh(geometry, material)
    this.object.frustumCulled = false
    this.object.renderOrder = 4
  }

  /** A world's own sky: whether it is passing through a shower, and from where. */
  setWorld(seed: Seed): void {
    const rng = createRng(seed).fork('meteors')
    const shower = rng.next() < 0.3
    const lean = rng.range(-1, 1)
    const round = rng.range(0, Math.PI * 2)
    const flat = Math.sqrt(1 - lean * lean)
    this.radiant.value.set(Math.cos(round) * flat, lean, Math.sin(round) * flat, shower ? 1 : 0)
  }

  /**
   * Follow the eye: `up` the sky's up over it in the room, `dark` 0 by day
   * to 1 at night with the eye low enough to see the sky as a sky, and
   * `scale` the planet's size.
   */
  update(up: THREE.Vector3, dark: number, scale: number): void {
    this.dark.value = dark
    this.object.visible = dark > 0.01
    this.up.value.copy(up)
    this.reach.value = DISTANCE * scale
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}
