import type * as THREE from 'three'

import { DETAIL_CITIES, DETAIL_CITY_LIGHT, DETAIL_CLOUD_SUN } from './detail'

/**
 * The towns' light at night, as it falls on whatever stands round them:
 * the same glow map the ground is lit by (settlements.ts, `townGlow`), read
 * at a point of the planet's own frame. The ground alone took it once, as a
 * flat orange of its own — so at night the sand round a village shone a
 * bright beige while its houses and trees, which took none, stood black
 * against it. Now the ground takes it as light on its own colour, and the
 * houses, trees and every weathered model take the same light.
 */
export const TOWN_GLOW_GLSL = /* glsl */ `
uniform sampler2D townGlowMap;
uniform float townGlowLight;
uniform vec3 townGlowSun;
vec3 townGlowAt(vec3 planet) {
  if (townGlowLight <= 0.0) return vec3(0.0);
  vec3 up = normalize(planet);
  vec2 uv = vec2(atan(up.z, -up.x) / 6.2831853 + 0.5, 1.0 - acos(clamp(up.y, -1.0, 1.0)) / 3.1415927);
  float dark = 1.0 - smoothstep(-0.12, 0.04, dot(up, townGlowSun));
  float town = texture2D(townGlowMap, uv).r;
  return vec3(1.0, 0.62, 0.3) * town * town * town * dark * townGlowLight;
}
`

/** Hand a shader the uniforms `TOWN_GLOW_GLSL` reads. */
export function withTownGlow(uniforms: Record<string, THREE.IUniform>): void {
  uniforms.townGlowMap = DETAIL_CITIES
  uniforms.townGlowLight = DETAIL_CITY_LIGHT
  uniforms.townGlowSun = DETAIL_CLOUD_SUN
}
