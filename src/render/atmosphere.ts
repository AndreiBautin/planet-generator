import * as THREE from 'three'

import { KINDS } from '@/generation/kinds'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The air seen edge-on: a halo just outside the limb, brightest where the
 * line of sight grazes the planet and fading into space, and lit by the sun
 * so the night side's rim is a thin dark crescent rather than a glowing ring.
 *
 * Drawn on the inside of a slightly larger sphere with additive blending —
 * the usual cheap stand-in for real scattering, and cheap is the point on a
 * phone.
 */
export function buildAtmosphere(planet: Planet, sun: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glow: { value: fromPalette(KINDS[planet.kind].atmosphere) },
      sun: { value: sun.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vToCamera;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vToCamera = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 glow;
      uniform vec3 sun;
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vToCamera;
      void main() {
        // On a back face the normal points away from the camera: nearly
        // straight away just outside the planet's limb, and side-on at the
        // halo's outer edge, so this is brightest at the limb and fades out.
        // Measured against the ray to this fragment, not the view axis: the
        // halo is thin, and under perspective the axis reads it as side-on
        // everywhere, which left the glow invisible.
        float facing = dot(vNormal, normalize(vToCamera));
        float rim = min(1.0, pow(max(0.0, 0.5 - facing), 3.0));
        float lit = clamp(dot(vWorldNormal, sun) * 0.9 + 0.3, 0.0, 1.0);
        gl_FragColor = vec4(glow * rim * lit * 1.6, rim * lit);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 32), material)
}
