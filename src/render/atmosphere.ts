import * as THREE from 'three'

import { KINDS } from '@/generation/kinds'
import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The air: a shell around the planet that glows by how much of it a line
 * of sight passes through, lit by the sun where it passes.
 *
 * From orbit, a line grazing the limb crosses the most air, so the planet
 * wears a bright rim that fades into space. From low down, looking at the
 * horizon crosses far more air than looking up, so the sky is pale at the
 * horizon and deepens overhead. The night side's air is dark because the
 * sun does not reach it.
 *
 * Drawn on the inside of the shell, so it is there whether the camera is
 * outside the air or in it, and only where nothing nearer has been drawn:
 * it is the sky, not a layer over the ground. Haze over distant ground is
 * the scene's fog, matched to this colour. It was this shader for a while,
 * with the depth test off and the ground taken as a sphere — and low down
 * the real hills stand above that sphere, so every ray towards one counted
 * the air under it and the land washed out white.
 *
 * Still a stand-in for real scattering — one sample, no integral — because
 * a phone has a frame to draw.
 */
export const AIR_RADIUS = 1.1
const GROUND_RADIUS = 1

export function buildAtmosphere(planet: Planet, sun: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glow: { value: fromPalette(KINDS[planet.kind].atmosphere) },
      sun: { value: sun.clone().normalize() },
      /** 0 to 1: how far the glow has come up, for a planet being born. */
      strength: { value: 1 },
      /** The shell and the ground, in the room's units: they grow with a planet being born. */
      outer: { value: AIR_RADIUS },
      inner: { value: GROUND_RADIUS },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 glow;
      uniform vec3 sun;
      uniform float strength;
      uniform float outer;
      uniform float inner;
      varying vec3 vWorld;

      // Where a ray from o along d enters and leaves a sphere at the origin.
      vec2 crossing(vec3 o, vec3 d, float radius) {
        float b = dot(o, d);
        float c = dot(o, o) - radius * radius;
        float h = b * b - c;
        if (h < 0.0) return vec2(1e9, -1e9);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }

      void main() {
        vec3 o = cameraPosition;
        vec3 d = normalize(vWorld - o);
        vec2 air = crossing(o, d, outer);
        float from = max(air.x, 0.0);
        float to = air.y;
        vec2 ground = crossing(o, d, inner);
        // A line that meets the ground stops there.
        if (ground.x > 0.0) to = min(to, ground.x);
        float path = to - from;
        if (path <= 0.0) discard;

        // How much air, as a share of the thickest line the shell holds —
        // raised to a power so long lines count for more than their length:
        // straight down through the shell is a faint haze, while the limb
        // and the horizon glow. A plain share washed the planet's face blue.
        float thickest = 2.0 * sqrt(outer * outer - inner * inner);
        float amount = 1.0 - exp(-4.0 * pow(path / thickest, 1.5));

        // Lit where the middle of the line is in sunlight, with a soft edge
        // so dusk is a band rather than a cut.
        vec3 middle = o + d * (from + to) * 0.5;
        float day = smoothstep(-0.25, 0.35, dot(normalize(middle), sun));

        // Looking towards the sun brightens and whitens the air around it.
        float toward = pow(max(dot(d, sun), 0.0), 10.0);
        vec3 colour = glow * (1.0 + toward * 0.8) + vec3(toward * 0.35);

        float a = amount * day * strength;
        gl_FragColor = vec4(colour * a * 1.3, 1.0);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(AIR_RADIUS, 64, 32), material)
  // After the ground and the clouds, so it fills only the sky they leave.
  mesh.renderOrder = 10
  return mesh
}
