import * as THREE from 'three'

import type { Planet } from '@/generation/planet'
import type { Volcano } from '@/generation/volcanoes'

import { DETAIL_TIME, NOISE } from './detail'
import { ERUPTION_GLSL, eruptionSeed } from './eruptions'
import { groundRadiusAt } from './patches/patch-data'

/**
 * A molten world's fire, beyond its lava: smoke rising from its tallest
 * peaks, lit orange from the vents at its foot and leaning off downwind,
 * and embers drifting up past the eye when it flies low.
 */

/** The sun in the room, for the plumes' lit side; set by the scene. */
export const PLUME_SUN = { value: new THREE.Vector3(1, 0, 0) }

/** How high the tallest plume stands over its summit, in radii. */
const PLUME_HEIGHT = 0.05

/** Puffs of smoke in each plume, rising one behind another. */
const PUFFS = 28

/**
 * The plumes: a stream of puffs from each volcano, each a soft round sprite
 * that leaves the vent, rises, bends downwind and grows as it thins, then
 * starts again at the vent — so the column is always rising, with nothing
 * moved on the page frame by frame. A single tall quad was tried first and
 * read as a beam of light, however it was shaded: smoke is lumps.
 * A child of the ground, so it turns with the planet.
 */
export function plumes(planet: Planet, volcanoes: readonly Volcano[]): THREE.Mesh | undefined {
  if (volcanoes.length === 0) return undefined
  const sites: number[] = []
  volcanoes.forEach((volcano, k) => {
    const base = groundRadiusAt(planet, volcano.at)
    const cycle = eruptionSeed(volcano.at)
    for (let puff = 0; puff < PUFFS; puff += 1) {
      const phase = (puff + 0.5) / PUFFS
      const jitter = Math.sin((k * 31 + puff) * 12.9898) * 43758.5453
      sites.push(...volcano.at, base, volcano.heat, phase, jitter - Math.floor(jitter), cycle)
    }
  })
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  )
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const buffer = new THREE.InstancedInterleavedBuffer(Float32Array.from(sites), 8, 1)
  quad.setAttribute('plumeAt', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
  quad.setAttribute('plumeBase', new THREE.InterleavedBufferAttribute(buffer, 1, 3))
  quad.setAttribute('plumeHeat', new THREE.InterleavedBufferAttribute(buffer, 1, 4))
  quad.setAttribute('plumePhase', new THREE.InterleavedBufferAttribute(buffer, 1, 5))
  quad.setAttribute('plumeSeed', new THREE.InterleavedBufferAttribute(buffer, 1, 6))
  quad.setAttribute('plumeCycle', new THREE.InterleavedBufferAttribute(buffer, 1, 7))
  quad.instanceCount = volcanoes.length * PUFFS
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { plumeTime: DETAIL_TIME, plumeSun: PLUME_SUN },
    vertexShader: /* glsl */ `
      uniform float plumeTime;
      uniform vec3 plumeSun;
      attribute vec3 plumeAt;
      attribute float plumeBase;
      attribute float plumeHeat;
      attribute float plumePhase;
      attribute float plumeSeed;
      attribute float plumeCycle;
      varying vec2 vCorner;
      varying float vAge;
      varying float vHeat;
      varying float vSeed;
      varying float vDay;
      varying float vErupting;
      ${ERUPTION_GLSL}
      void main() {
        vec3 up = normalize(plumeAt);
        // Thicker and fiercer at the vent while the volcano erupts (eruptions.ts).
        vErupting = eruption(plumeTime, plumeCycle);
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
        vec3 north = cross(up, east);
        // How far along its rise this puff is, 0 at the vent.
        float age = fract(plumePhase + plumeTime * 0.018);
        float tall = ${PLUME_HEIGHT.toFixed(4)} * (0.45 + 0.55 * plumeHeat);
        // Up, then off downwind, wandering a little to either side.
        float wander = (plumeSeed - 0.5) * age * tall * 0.5;
        vec3 along = up * (plumeBase + age * tall) + east * age * age * tall * 1.3 + north * wander;
        float scale = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        float size = mix(0.0025, 0.016, pow(age, 0.7)) * (0.5 + 0.5 * plumeHeat) * (0.9 + 0.2 * vErupting) * scale;
        vec4 view = viewMatrix * modelMatrix * vec4(along, 1.0);
        // Turned by its seed so no two puffs show the same face.
        float turn = plumeSeed * 6.283 + age * 1.5;
        vec2 corner = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * position.xy;
        view.xy += corner * size;
        vCorner = position.xy;
        vAge = age;
        vHeat = plumeHeat;
        vSeed = plumeSeed;
        vec3 worldUp = normalize((modelMatrix * vec4(up, 0.0)).xyz);
        vDay = smoothstep(-0.05, 0.15, dot(worldUp, normalize(plumeSun)));
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vCorner;
      varying float vAge;
      varying float vHeat;
      varying float vSeed;
      varying float vDay;
      varying float vErupting;
      ${NOISE}
      void main() {
        // A soft round lump, its edge broken by a noise.
        float r = length(vCorner);
        float lump = detailNoise(vec3(vCorner * 2.2, vSeed * 17.0)) * 0.6 + detailNoise(vec3(vCorner * 5.0, vSeed * 9.0)) * 0.4;
        float puff = 1.0 - smoothstep(0.2 + 0.5 * lump, 0.95, r);
        // In fast at the vent, thinning out as it spreads.
        float density = puff * smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
        if (density < 0.01) discard;
        // Ash grey where the sun reaches it, near black where it does not;
        // lit from beneath by the vent, orange near it, the underside of
        // each puff catching it a little higher.
        // Each puff lit on top and shadowed underneath, which is what gives
        // smoke its lumps; brown-grey ash, not white steam.
        float top = 0.6 + 0.4 * smoothstep(-0.8, 0.8, vCorner.y + (lump - 0.5) * 0.8);
        // At night a dark shape against the stars, its foot lit by the vent:
        // at 0.05 it was brighter than the sky by far and read as a lit column.
        vec3 ash = mix(vec3(0.012, 0.011, 0.011), vec3(0.27, 0.24, 0.22) * top * (0.8 + 0.3 * lump), vDay);
        // A little fiercer while erupting, no more: doubled, the lit puffs at
        // the vent swelled into one glowing ball over the summit.
        float vent = exp(-vAge * 16.0) * vHeat * (0.85 + 0.35 * vErupting);
        float under = exp(-vAge * 6.0) * smoothstep(-0.2, -1.0, vCorner.y) * 0.4 * vHeat;
        // The vent's light is light on smoke, not a colour of its own: the
        // ash's own dark brown lit a deep red-orange, mostly from beneath.
        // Added as raw orange, every young puff glowed and stacked into
        // one peach-coloured column over the summit at night.
        float beneath = 0.35 + 0.65 * smoothstep(0.3, -0.8, vCorner.y + (lump - 0.5) * 0.6);
        vec3 lit = vec3(0.27, 0.24, 0.22) * vec3(1.0, 0.42, 0.12);
        vec3 colour = ash + lit * (vent * 2.6 * beneath + under * 2.0);
        gl_FragColor = vec4(colour, density * mix(0.85, 0.5, vAge));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(quad, material)
  // Culled by nothing: the instances span the planet, the quad does not.
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  return mesh
}

/** Embers in the box round the eye, in planet radii. */
const EMBERS = 700
const RADIUS = 0.007
const HEIGHT = 0.012

/**
 * Embers: sparks drifting up through the air round the eye, flickering,
 * glowing, on a molten world when it flies low. Points whose rise is a
 * function of time in the vertex shader, so nothing moves on the page
 * frame by frame — the rain's arrangement (rain.ts), going the other way.
 */
export class Embers {
  readonly object: THREE.Points
  private readonly strength = { value: 0 }
  private readonly up = new THREE.Vector3()
  private static readonly Y = new THREE.Vector3(0, 1, 0)

  constructor() {
    const seeds = new Float32Array(EMBERS * 3)
    let h = 777
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    for (let k = 0; k < EMBERS; k += 1) {
      seeds[k * 3] = next() * 2 - 1
      seeds[k * 3 + 1] = next()
      seeds[k * 3 + 2] = next() * 2 - 1
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HEIGHT)
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { emberTime: DETAIL_TIME, emberStrength: this.strength },
      vertexShader: /* glsl */ `
        uniform float emberTime;
        uniform float emberStrength;
        varying float vGlow;
        void main() {
          float pace = 0.05 + fract(position.x * 7.31 + position.z * 3.17) * 0.06;
          float lift = fract(position.y + emberTime * pace);
          float sway = sin(emberTime * 0.9 + position.z * 30.0) * 0.0008 + sin(emberTime * 2.1 + position.x * 17.0) * 0.0003;
          vec3 local = vec3(position.x * ${RADIUS.toFixed(4)} + sway, (lift - 0.5) * ${HEIGHT.toFixed(4)}, position.z * ${RADIUS.toFixed(4)} - sway * 0.7);
          vec4 view = modelViewMatrix * vec4(local, 1.0);
          float edge = 1.0 - smoothstep(0.6, 1.0, length(position.xz));
          // Brightest low down, dying as they rise, and flickering.
          float flicker = 0.6 + 0.4 * sin(emberTime * (7.0 + position.x * 5.0) + position.z * 40.0);
          vGlow = edge * (1.0 - lift) * flicker * emberStrength;
          gl_PointSize = clamp(0.0035 / max(-view.z, 1e-4) * 120.0, 1.5, 9.0);
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float spot = 1.0 - smoothstep(0.15, 0.5, length(d));
          if (spot * vGlow < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.5, 0.12) * 3.0, spot * vGlow);
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

  /** Place the embers at the eye, rising along its up, as many as `strength` (0 to 1) asks. */
  update(eye: THREE.Vector3, strength: number): void {
    this.strength.value = strength
    this.object.visible = strength > 0.01
    if (!this.object.visible) return
    this.object.position.copy(eye)
    this.up.copy(eye).normalize()
    this.object.quaternion.setFromUnitVectors(Embers.Y, this.up)
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}
