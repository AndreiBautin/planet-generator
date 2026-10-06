import * as THREE from 'three'

import type { Planet } from '@/generation/planet'
import { createRng } from '@/generation/rng'

import { DETAIL_TIME, NOISE } from './detail'
import { VALLEY_FOG } from './valley-fog'

/**
 * Aurora: curtains of light hanging round each pole on the night side,
 * folding and drifting. A band round each pole — a ring of tall quads
 * standing on an oval a little way from the pole, wandering in latitude —
 * drawn additively, green at its foot where it is brightest and fading to
 * red and violet up its height, shimmering along its length.
 *
 * Only where it is dark: the sun puts it out on the day side, as it does
 * the real thing. Only on worlds with air worth lighting: none on a molten
 * one, whose sky is already lit by its fires.
 */

/** Columns round each pole's band. */
const AROUND = 240
/** Where the curtain stands, in degrees from the pole, and how far it wanders. */
const FROM_POLE = 21
const WANDER = 4
/** The curtain's foot and top, in radii above the ground's middle. */
const FOOT = 1.016
const TOP = 1.06

/** How bright a planet's aurora is, 0 with none: its own draw from the seed. */
export function auroraStrength(planet: Planet): number {
  if (planet.molten || planet.kind === 'arid') return 0
  return 0.55 + createRng(planet.seed).fork('aurora').next() * 0.45
}

export function auroraFor(planet: Planet): THREE.Mesh | undefined {
  if (planet.molten || planet.kind === 'arid') return undefined
  const rng = createRng(planet.seed).fork('aurora')
  const strength = 0.55 + rng.next() * 0.45
  const phase = rng.next() * Math.PI * 2
  const positions: number[] = []
  const along: number[] = []
  const index: number[] = []
  for (const pole of [1, -1]) {
    const start = positions.length / 3
    for (let k = 0; k <= AROUND; k += 1) {
      const turn = (k / AROUND) * Math.PI * 2
      // Wandering in latitude at a couple of scales, so the oval folds.
      const colatitude =
        ((FROM_POLE +
          WANDER * Math.sin(turn * 3 + phase) +
          WANDER * 0.5 * Math.sin(turn * 7 - phase * 2)) *
          Math.PI) /
        180
      const r = Math.sin(colatitude)
      const x = Math.cos(turn) * r
      const z = Math.sin(turn) * r
      const y = Math.cos(colatitude) * pole
      for (const height of [0, 1]) {
        const radius = height === 0 ? FOOT : TOP
        positions.push(x * radius, y * radius, z * radius)
        along.push(k / AROUND, height, pole)
      }
    }
    for (let k = 0; k < AROUND; k += 1) {
      const a = start + k * 2
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aurora', new THREE.Float32BufferAttribute(along, 3))
  geometry.setIndex(index)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      auroraTime: DETAIL_TIME,
      auroraSun: VALLEY_FOG.sun,
      auroraStrength: { value: strength },
      auroraPhase: { value: phase },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aurora;
      varying vec3 vAurora;
      varying float vDark;
      varying vec3 vWorld;
      uniform vec3 auroraSun;
      void main() {
        vAurora = aurora;
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorld = world;
        // Put out on the day side and through the twilight.
        vDark = 1.0 - smoothstep(-0.25, 0.02, dot(normalize(world), normalize(auroraSun)));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float auroraTime;
      uniform float auroraStrength;
      uniform float auroraPhase;
      varying vec3 vAurora;
      varying float vDark;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        if (vDark <= 0.01) discard;
        float u = vAurora.x;
        float h = vAurora.y;
        // Folds: bright rays along the curtain, drifting and changing,
        // and broad brighter and dimmer stretches over them.
        float t = auroraTime * 0.06;
        float rays = detailNoise(vec3(u * 260.0, t * 3.0, auroraPhase + vAurora.z));
        rays = pow(rays, 3.0) * 2.4;
        float stretch = smoothstep(0.25, 0.75, detailNoise(vec3(u * 22.0 - t, t * 0.7, auroraPhase * 3.0 + vAurora.z)));
        // Brightest just above its foot, a sharp lower edge, a long fade up.
        float body = smoothstep(0.0, 0.08, h) * exp(-h * 2.6);
        // Green low, red and violet high.
        vec3 colour = mix(vec3(0.15, 1.0, 0.45), vec3(0.85, 0.2, 0.55), smoothstep(0.25, 0.8, h));
        float light = body * (0.35 + rays) * (0.3 + 0.7 * stretch) * auroraStrength * vDark;
        gl_FragColor = vec4(colour * light * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 4
  mesh.frustumCulled = false
  return mesh
}
