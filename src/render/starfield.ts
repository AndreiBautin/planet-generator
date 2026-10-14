import * as THREE from 'three'

import type { Planet } from '@/generation/planet'
import { createRng } from '@/generation/rng'
import { galaxyBand, starField } from '@/generation/stars'

import { NOISE } from './detail'

/** How far out the stars are laid, before they are scaled to the far plane. */
export const STAR_RADIUS = 60

export function buildSky(world: Planet, pixelRatio: number): THREE.Points {
  const stars = starField(createRng(world.seed).fork('stars'), 2500, STAR_RADIUS)
  const points = (positions: Float32Array, colours: Float32Array, size: number): THREE.Points => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: size * pixelRatio,
        sizeAttenuation: false,
        vertexColors: true,
        toneMapped: false,
        // Stars are far beyond the air and must not take the haze's colour.
        fog: false,
        transparent: true,
      }),
    )
  }
  const sky = points(stars.positions, stars.colours, 1.2)
  // The galaxy's band (stars.ts): thousands of faint stars crowded along a
  // great circle, and behind them a soft glow, mottled, so it reads as a
  // band of light and not a stripe of dots.
  const band = galaxyBand(createRng(world.seed).fork('galaxy'), 6000, STAR_RADIUS * 0.995)
  sky.add(points(band.positions, band.colours, 1))
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(STAR_RADIUS * 0.99, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        bandNormal: { value: new THREE.Vector3(...band.normal) },
        bandSeen: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vSky;
        void main() {
          vSky = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 bandNormal;
        uniform float bandSeen;
        varying vec3 vSky;
        ${NOISE}
        void main() {
          float off = dot(vSky, bandNormal);
          float mottle = detailNoise(vSky * 6.0) * 0.6 + detailNoise(vSky * 17.0) * 0.4;
          // Its edge frayed by the same mottle, so it is not a ruled stripe.
          float edge = off + (detailNoise(vSky * 9.0 + 4.0) - 0.5) * 0.06;
          float band = exp(-edge * edge / 0.005);
          // A dark lane down its middle, as dust splits the real one.
          // Squared by hand: pow of a negative base is NaN (sea-light.ts).
          float laneAt = (off + (mottle - 0.5) * 0.03) / 0.014;
          float lane = 1.0 - 0.6 * exp(-laneAt * laneAt);
          float light = band * (0.15 + 1.4 * pow(mottle, 1.6)) * lane * bandSeen;
          // Coloured, not grey: warmer where it is brightest, as a galaxy's
          // old stars crowd its core, bluer out at the fringes, with now
          // and then a reddish knot where stars are forming. A flat grey
          // band read as a smear on the lens.
          float core = smoothstep(0.35, 0.85, mottle);
          vec3 tint = mix(vec3(0.5, 0.58, 0.82), vec3(0.86, 0.78, 0.68), core);
          float knots = smoothstep(0.72, 0.9, detailNoise(vSky * 23.0 + 7.0)) * band;
          tint = mix(tint, vec3(0.95, 0.5, 0.6), knots * 0.5);
          // And off the band, faint clouds of colour, so the sky has depth
          // rather than being black between the stars.
          float haze = smoothstep(0.55, 0.85, detailNoise(vSky * 2.4 + 13.0)) * (1.0 - band);
          vec3 nebula = mix(vec3(0.25, 0.32, 0.6), vec3(0.45, 0.25, 0.5), detailNoise(vSky * 3.1));
          gl_FragColor = vec4((tint * light * 0.085 + nebula * haze * 0.018) * bandSeen, 1.0);
        }
      `,
    }),
  )
  glow.renderOrder = -2
  sky.add(glow)
  return sky
}
