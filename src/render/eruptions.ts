import * as THREE from 'three'

import type { Vec3 } from '@/generation/cube'
import { surfaceAt, type Planet } from '@/generation/planet'
import type { Volcano } from '@/generation/volcanoes'

import { DETAIL_TIME, NOISE } from './detail'
import { groundRadiusAt } from './patches/patch-data'

/**
 * Eruptions on a molten world: each volcano (generation/volcanoes.ts) goes
 * through a cycle of its own — quiet, then a burst of fountaining for a
 * stretch, then quiet again — throwing glowing bombs out of its vent in
 * arcs, its plume thickening while it does (volcanic.ts reads the same
 * cycle). Down its flanks run rivers of lava, the steepest way down to the
 * lava sea, glowing in their cracks under a crust that crawls downhill.
 *
 * **One cycle, read in three places**: `ERUPTION_GLSL`, given each volcano's
 * seed from `eruptionSeed` (where it stands), so the fountain, the flows'
 * brightness and the plume agree about when a volcano is erupting; `eruption`
 * is the same rule for the tests.
 */

/** How long a volcano's cycle runs, in seconds, and the share of it spent erupting. */
export const ERUPTION_PERIOD = 45
const ERUPTING = 0.32

/** How erupting a volcano is at `seconds`, 0 to 1, from its own `seed` (0 to 1). */
export function eruption(seconds: number, seed: number): number {
  const p = fract(seconds / ERUPTION_PERIOD + seed)
  return smooth(0, 0.03, p) * (1 - smooth(ERUPTING - 0.06, ERUPTING, p))
}

/** A volcano's seed, 0 to 1, from where it stands: what the shaders compute too. */
export function eruptionSeed(at: Vec3): number {
  return fract(Math.sin(at[0] * 12.9898 + at[1] * 78.233 + at[2] * 37.719) * 43758.5453)
}

/**
 * The cycle for a shader. The seed is passed in from `eruptionSeed`, never
 * hashed on the GPU: the same hash in 32-bit floats came out a different
 * number, so the fountains, the flows and the plume each kept their own
 * time and the bombs flew while the flows lay quiet.
 */
export const ERUPTION_GLSL = /* glsl */ `
float eruption(float seconds, float seed) {
  float p = fract(seconds / ${ERUPTION_PERIOD.toFixed(1)} + seed);
  return smoothstep(0.0, 0.03, p) * (1.0 - smoothstep(${(ERUPTING - 0.06).toFixed(3)}, ${ERUPTING.toFixed(3)}, p));
}
`

/** Bombs thrown from each vent. */
const BOMBS = 70
/** Flows down from each volcano, the steps down them, and each step's length in radians. */
const FLOWS = 3
const STEPS = 48
const STRIDE = 0.0012

export class Eruptions {
  readonly group = new THREE.Group()

  constructor(planet: Planet, volcanoes: readonly Volcano[]) {
    if (volcanoes.length === 0) return
    const flows = flowMesh(planet, volcanoes)
    if (flows !== undefined) this.group.add(flows)
    this.group.add(fountains(planet, volcanoes))
  }
}

/** The fountains: glowing bombs arcing from each vent while it erupts. */
function fountains(planet: Planet, volcanoes: readonly Volcano[]): THREE.Points {
  const sites: number[] = []
  volcanoes.forEach((volcano) => {
    const base = groundRadiusAt(planet, volcano.at)
    for (let k = 0; k < BOMBS; k += 1) {
      const h = fract(Math.sin((k + 1) * 91.345 + volcano.at[0] * 311.7) * 43758.5453)
      sites.push(
        volcano.at[0] * base,
        volcano.at[1] * base,
        volcano.at[2] * base,
        volcano.heat,
        k / BOMBS,
        h,
        eruptionSeed(volcano.at),
      )
    }
  })
  const geometry = new THREE.BufferGeometry()
  const buffer = new THREE.InterleavedBuffer(Float32Array.from(sites), 7)
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
  geometry.setAttribute('bombHeat', new THREE.InterleavedBufferAttribute(buffer, 1, 3))
  geometry.setAttribute('bombPhase', new THREE.InterleavedBufferAttribute(buffer, 1, 4))
  geometry.setAttribute('bombSeed', new THREE.InterleavedBufferAttribute(buffer, 1, 5))
  geometry.setAttribute('bombCycle', new THREE.InterleavedBufferAttribute(buffer, 1, 6))
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { bombTime: DETAIL_TIME },
      vertexShader: /* glsl */ `
        uniform float bombTime;
        attribute float bombHeat;
        attribute float bombPhase;
        attribute float bombSeed;
        attribute float bombCycle;
        varying float vGlow;
        ${ERUPTION_GLSL}
        void main() {
          vec3 up = normalize(position);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(up, east);
          // Each bomb flies for a couple of seconds, thrown at its own angle
          // and speed, and is thrown again when it lands.
          float life = 2.4 + bombSeed * 1.2;
          float t = fract(bombTime / life + bombPhase) * life;
          float launched = bombTime - t;
          float erupting = eruption(launched, bombCycle);
          float a = bombSeed * 6.2831853 * 7.0;
          // Not "out", a GLSL keyword: named so, the shader failed to compile
          // and the fountains drew nothing, with no error on the page.
          vec3 outward = cos(a) * east + sin(a) * north;
          // Thrown high enough to read from a glide's distance: at half this a
          // fountain was a glow at the vent.
          float speed = (0.006 + 0.006 * fract(bombSeed * 13.7)) * (0.6 + 0.6 * bombHeat);
          float rise = speed * t - 0.0032 * t * t;
          float wide = speed * 0.45 * fract(bombSeed * 5.3 + 0.2) * t;
          vec3 p = position + up * max(rise, -0.0004) + outward * wide;
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          float landed = rise < 0.0 ? 0.0 : 1.0;
          vGlow = erupting * landed * (1.0 - smoothstep(0.6, 1.0, t / life));
          float scale = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          gl_PointSize = vGlow > 0.01 ? clamp(0.0005 * scale / max(-view.z, 1e-6) * 900.0, 2.5, 11.0) : 0.0;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          float spot = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
          // Yellow-white hot at the core, red at the edge.
          vec3 colour = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.85, 0.45), spot * spot);
          gl_FragColor = vec4(colour * spot * vGlow * 1.6, 1.0);
        }
      `,
    }),
  )
  points.frustumCulled = false
  points.renderOrder = 3
  return points
}

/**
 * The flows: from each volcano, a few rivers of lava the steepest way down
 * its flanks to the lava sea or a hollow, as glowing ribbons laid on the
 * ground. Found once per world on the page — a few thousand samples of the
 * surface — the way water would run.
 */
function flowMesh(planet: Planet, volcanoes: readonly Volcano[]): THREE.Mesh | undefined {
  const positions: number[] = []
  const along: number[] = []
  const across: number[] = []
  const seeds: number[] = []
  const index: number[] = []
  const height = (d: Vec3): number => surfaceAt(planet, d[0], d[1], d[2]).height
  volcanoes.forEach((volcano) => {
    const seed = eruptionSeed(volcano.at)
    for (let f = 0; f < FLOWS; f += 1) {
      // Set off down a different face each time, then always downhill.
      let heading = (f / FLOWS + seed) * Math.PI * 2
      let at = around(volcano.at, STRIDE * 1.5, heading)
      const path: Vec3[] = [volcano.at, at]
      for (let s = 0; s < STEPS; s += 1) {
        const here = height(at)
        if (here <= 0) break
        let best: { at: Vec3; h: number; heading: number } | undefined
        for (let k = -2; k <= 2; k += 1) {
          const h = heading + k * 0.45
          const next = around(at, STRIDE, h)
          const nh = height(next)
          if (best === undefined || nh < best.h) best = { at: next, h: nh, heading: h }
        }
        if (best === undefined || best.h >= here) break
        heading = best.heading
        at = best.at
        path.push(at)
      }
      if (path.length < 4) continue
      const base = positions.length / 3
      let run = 0
      path.forEach((p, k) => {
        const radius = groundRadiusAt(planet, p) + 0.00006
        const next = path[Math.min(path.length - 1, k + 1)] ?? p
        const prev = path[Math.max(0, k - 1)] ?? p
        const dir: Vec3 = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]
        const side = unit(cross(p, dir))
        // Widest a little below the vent, narrowing to its toe.
        const t = k / (path.length - 1)
        const half =
          (0.00025 + 0.0006 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.1))) *
          (0.6 + 0.4 * volcano.heat)
        if (k > 0) run += Math.acos(Math.min(1, dot(p, prev)))
        for (const s of [-1, 1]) {
          positions.push(
            p[0] * radius + side[0] * half * s,
            p[1] * radius + side[1] * half * s,
            p[2] * radius + side[2] * half * s,
          )
          along.push(run / STRIDE, t)
          across.push(s)
          seeds.push(seed)
        }
        if (k > 0) {
          const v = base + k * 2
          index.push(v - 2, v - 1, v, v - 1, v + 1, v)
        }
      })
    }
  })
  if (positions.length === 0) return undefined
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('flowAlong', new THREE.Float32BufferAttribute(along, 2))
  geometry.setAttribute('flowAcross', new THREE.Float32BufferAttribute(across, 1))
  geometry.setAttribute('flowSeed', new THREE.Float32BufferAttribute(seeds, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { flowTime: DETAIL_TIME },
    vertexShader: /* glsl */ `
      attribute vec2 flowAlong;
      attribute float flowAcross;
      attribute float flowSeed;
      varying vec2 vAlong;
      varying float vAcross;
      varying float vSeed;
      varying vec3 vAt;
      void main() {
        vAlong = flowAlong;
        vAcross = flowAcross;
        vSeed = flowSeed;
        vAt = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float flowTime;
      varying vec2 vAlong;
      varying float vAcross;
      varying float vSeed;
      varying vec3 vAt;
      ${NOISE}
      ${ERUPTION_GLSL}
      void main() {
        // A crust of dark rock crawling downhill, cracked open to the glow
        // beneath; hotter and more open near the vent and in the middle of
        // the stream, and all of it brighter while the volcano erupts.
        float down = vAlong.x - flowTime * 0.12;
        float crust = detailNoise(vec3(down * 1.3, vAcross * 1.5, vSeed * 40.0)) * 0.6 +
          detailNoise(vec3(down * 4.0, vAcross * 3.0, vSeed * 17.0)) * 0.4;
        float middle = 1.0 - vAcross * vAcross;
        float hot = (1.0 - vAlong.y * 0.7) * middle;
        float erupting = eruption(flowTime, vSeed);
        float open = smoothstep(0.62 - 0.25 * hot - 0.1 * erupting, 0.72, 1.0 - crust);
        vec3 rock = vec3(0.05, 0.035, 0.03);
        vec3 glow = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.7, 0.2), open * hot);
        vec3 colour = mix(rock, glow * (1.4 + 0.8 * erupting), open);
        // Its edge frays into the ground rather than ending in a line.
        float edge = smoothstep(1.0, 0.75, abs(vAcross));
        if (edge < 0.05) discard;
        gl_FragColor = vec4(colour, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1
  return mesh
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** A point `distance` radians from `centre`, at `bearing` round it. */
function around(centre: Vec3, distance: number, bearing: number): Vec3 {
  const helper: Vec3 = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit(cross(helper, centre))
  const e2 = cross(centre, e1)
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  const cb = Math.cos(bearing)
  const sb = Math.sin(bearing)
  return unit([
    centre[0] * c + (e1[0] * cb + e2[0] * sb) * s,
    centre[1] * c + (e1[1] * cb + e2[1] * sb) * s,
    centre[2] * c + (e1[2] * cb + e2[2] * sb) * s,
  ])
}

const fract = (x: number): number => x - Math.floor(x)

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
