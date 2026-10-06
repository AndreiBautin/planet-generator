import * as THREE from 'three'

import type { Vec3 } from './patches/cube'

/**
 * Eclipses of the sun: a moon passing between it and the planet throws
 * its shadow on the ground — a dark core where the sun is hidden, a wide
 * soft edge where only part of it is. With moons a few radii out and a
 * few tenths of a radius across, their orbits a little tilted, a shadow
 * crosses the world on many turns of a moon, and takes some seconds to.
 *
 * The moons are passed as `vec4(centre, radius)`, in whichever frame the
 * point and the sun are: the ground's (`DETAIL_MOONS`) or the cloud
 * layer's, which turns a little faster (`DETAIL_CLOUD_MOONS`). A radius of
 * nought is no moon.
 */
export const DETAIL_MOONS = { value: [new THREE.Vector4(), new THREE.Vector4()] }
export const DETAIL_CLOUD_MOONS = { value: [new THREE.Vector4(), new THREE.Vector4()] }

/** How much wider the soft edge grows, per radius of distance behind the moon, each way. */
export const SUN_SPREAD = 0.03
/** How much of the sun is left in the core of the shadow. */
export const ECLIPSE_FLOOR = 0.06

/** Moon shadows in GLSL; needs `uniform vec4 detailMoons[2]` declared. Returns how much sun is taken. */
export const MOON_SHADOW = /* glsl */ `
  float moonShadowFrom(vec3 p, vec3 sun) {
    float lit = 1.0;
    for (int k = 0; k < 2; k++) {
      vec4 moon = detailMoons[k];
      if (moon.w <= 0.0) continue;
      vec3 to = moon.xyz - p;
      float along = dot(to, sun);
      if (along <= 0.0) continue;
      float miss = length(to - sun * along);
      float spread = along * ${SUN_SPREAD.toFixed(4)};
      lit *= mix(${ECLIPSE_FLOOR.toFixed(3)}, 1.0, smoothstep(moon.w - spread, moon.w + spread, miss));
    }
    return 1.0 - lit;
  }
`

export type MoonDisc = readonly [number, number, number, number]

/** The same, on the page: how much of the sun the moons take from `point`. */
export function moonShadow(point: Vec3, sun: Vec3, moons: readonly MoonDisc[]): number {
  let lit = 1
  for (const [x, y, z, radius] of moons) {
    if (radius <= 0) continue
    const to: Vec3 = [x - point[0], y - point[1], z - point[2]]
    const along = to[0] * sun[0] + to[1] * sun[1] + to[2] * sun[2]
    if (along <= 0) continue
    const miss = Math.hypot(to[0] - sun[0] * along, to[1] - sun[1] * along, to[2] - sun[2] * along)
    const spread = along * SUN_SPREAD
    lit *= ECLIPSE_FLOOR + (1 - ECLIPSE_FLOOR) * smoothstep(radius - spread, radius + spread, miss)
  }
  return 1 - lit
}

/**
 * Eclipses of a moon: how much of the sun reaches a moon at `where`, in
 * planet radii from its centre, the planet's own shadow falling on it —
 * 1 in full sun, 0 deep in the shadow, where it turns the red of every
 * sunset on the world's rim at once.
 */
export function moonLight(where: Vec3, sun: Vec3): number {
  const along = where[0] * sun[0] + where[1] * sun[1] + where[2] * sun[2]
  if (along >= 0) return 1
  const miss = Math.hypot(
    where[0] - sun[0] * along,
    where[1] - sun[1] * along,
    where[2] - sun[2] * along,
  )
  const spread = -along * SUN_SPREAD
  return smoothstep(1 - spread, 1 + spread, miss)
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}
