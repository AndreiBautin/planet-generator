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
 * The glow is single scattering, integrated along the line in eight steps
 * with three towards the sun from each: enough for a phone, and enough for
 * a low sun to redden through the air it crosses. `sunlightThrough` is the
 * same model on the CPU, for the sun's colour on the ground and the haze.
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

      // Single scattering through a thin shell of air: Rayleigh scattering
      // by the air itself, coloured by this world's air (the colour it
      // scatters is the colour it is), and Mie scattering by haze, which
      // glows white round the sun. Light reaching a point has crossed air
      // on its way from the sun and lost the colour the air scatters, so a
      // low sun reddens on an earthly world, and on another world turns
      // whatever its air does not scatter.
      const int VIEW_STEPS = 8;
      const int SUN_STEPS = 3;

      vec3 rayleighBeta() {
        return glow / max(max(glow.r, glow.g), max(glow.b, 1e-3)) * 14.0;
      }

      // Optical depth from p towards the sun, out to the top of the air:
      // Rayleigh and Mie, each a density integral.
      vec2 towardSun(vec3 p, float rayleighHeight, float mieHeight) {
        vec2 out_ = crossing(p, sun, outer);
        float length_ = max(out_.y, 0.0);
        float step_ = length_ / float(SUN_STEPS);
        vec2 depth = vec2(0.0);
        for (int k = 0; k < SUN_STEPS; k++) {
          vec3 q = p + sun * (float(k) + 0.5) * step_;
          float height = length(q) - inner;
          depth += vec2(exp(-height / rayleighHeight), exp(-height / mieHeight)) * step_;
        }
        return depth;
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

        float thickness = outer - inner;
        float rayleighHeight = thickness * 0.25;
        float mieHeight = thickness * 0.08;
        vec3 betaR = rayleighBeta();
        vec3 betaM = vec3(3.0);

        float step_ = path / float(VIEW_STEPS);
        vec2 viewDepth = vec2(0.0);
        vec3 sumR = vec3(0.0);
        vec3 sumM = vec3(0.0);
        for (int k = 0; k < VIEW_STEPS; k++) {
          vec3 p = o + d * (from + (float(k) + 0.5) * step_);
          float height = max(length(p) - inner, 0.0);
          vec2 density = vec2(exp(-height / rayleighHeight), exp(-height / mieHeight)) * step_;
          viewDepth += density;
          // The planet's shadow, soft-edged: how close the line to the sun
          // passes the planet's centre, on the night side of the point. A
          // hard test drew the shadow's edge across the dusk sky as a line.
          float along = dot(p, sun);
          float miss = length(p - sun * along);
          float lit = along > 0.0 ? 1.0 : smoothstep(inner * 0.97, inner * 1.02, miss);
          if (lit <= 0.0) continue;
          vec2 sunDepth = towardSun(p, rayleighHeight, mieHeight);
          vec3 lost = exp(-(betaR * (viewDepth.x + sunDepth.x) + betaM * 1.1 * (viewDepth.y + sunDepth.y)));
          sumR += density.x * lost * lit;
          sumM += density.y * lost * lit;
        }
        float mu = dot(d, sun);
        float phaseR = 0.0597 * (1.0 + mu * mu);
        float g = 0.76;
        float phaseM = 0.1194 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
        vec3 sky = (sumR * betaR * phaseR + sumM * betaM * phaseM) * 9.0 * strength;
        // Sunset: the dust and haze low in the air redden the sun far more
        // than the air alone does, and glow round it as it sets — orange
        // whatever colour the air is. Only from inside the air, low on the
        // sky, towards the sun, while it is within a few degrees of the
        // horizon. Left to the air alone a teal world's dusk went green.
        float sunUp = dot(normalize(o), sun);
        float inside = 1.0 - smoothstep(inner + thickness * 0.4, outer, length(o));
        float dusk = smoothstep(0.3, 0.02, sunUp) * smoothstep(-0.22, -0.02, sunUp);
        float low = pow(1.0 - abs(dot(d, normalize(o))), 3.0);
        float toward = max(mu, 0.0);
        float lobe = pow(toward, 3.0) * 0.5 + pow(toward, 24.0) * 1.4;
        sky += vec3(1.0, 0.38, 0.1) * lobe * low * dusk * inside * strength * 0.9;
        // Linear light out: the frame is tone-mapped and encoded once, at
        // the end, by the post pass, like every other material's.
        gl_FragColor = vec4(sky, 1.0);
        // Tone mapped and encoded like every built-in material: a no-op when
        // the post pass renders into its own target and encodes at the end,
        // and the whole conversion when the frame goes straight to the
        // screen (a modest phone). Without it the sky there stayed linear
        // and came out a dark, over-saturated blue.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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

/**
 * What is left of sunlight after crossing the air to a point where the sun
 * stands `elevation` (its sine) above the horizon, by the same Rayleigh
 * model the sky shader integrates: the colour this air scatters is the
 * colour taken out, so a low sun reddens on an earthly world. Normalised so
 * the sun overhead is white, and written into `out`.
 */
export function sunlightThrough(
  glow: { readonly r: number; readonly g: number; readonly b: number },
  elevation: number,
  out: THREE.Color,
): THREE.Color {
  const strongest = Math.max(glow.r, glow.g, glow.b, 1e-3)
  const thickness = AIR_RADIUS - GROUND_RADIUS
  const height = thickness * 0.25
  // The length of air crossed grows as the sun sinks: about one scale
  // height overhead, a dozen at the horizon.
  const depth = (k: number): number => height / Math.max(0.02, k + 0.08)
  const lost = (channel: number, k: number): number =>
    Math.exp(-(channel / strongest) * 14 * depth(k))
  const e = Math.max(-0.1, elevation)
  out.setRGB(
    lost(glow.r, e) / lost(glow.r, 1),
    lost(glow.g, e) / lost(glow.g, 1),
    lost(glow.b, e) / lost(glow.b, 1),
  )
  return out
}
