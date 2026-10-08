import type { Vec3 } from '@/generation/cube'

/**
 * The open sea's swell: four Gerstner trains, read by the water's shader
 * (detail.ts) to move the surface and here to lift what floats on it. One
 * table, so a ship rides the wave the water draws — at a fixed height the
 * swell, five times a hull's height, rose over the ships and they sailed
 * along under a blue lid of sea.
 *
 * Each train is a heading (radians from east), a wavelength and a
 * steepness (in radii, and its share of a full fold) and a period
 * (seconds). The steepnesses sum to under a half: a Gerstner surface
 * folds through itself once the trains' steepness, times the 0.8 of their
 * sideways push and the shoaling, passes one. At 0.83 it reached 1.13 in
 * the shallows, and the sea by every shore folded up through itself.
 */
export const SWELL_TRAINS: readonly (readonly [number, number, number, number])[] = [
  [0.3, 0.02, 0.08, 11],
  [1.9, 0.0105, 0.1, 7.5],
  [-0.8, 0.0055, 0.11, 5.2],
  [2.6, 0.0028, 0.12, 3.6],
]

/** Where the swell fades out with distance from the eye, so far coarse patches lie still. */
export const SWELL_NEAR = 0.02
export const SWELL_FAR = 0.14

const glslFloat = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : String(value)

/** The trains as GLSL: `vec4 trains[4]` filled in. */
export const SWELL_TRAINS_GLSL = [
  `vec4 trains[${String(SWELL_TRAINS.length)}];`,
  ...SWELL_TRAINS.map(
    (train, i) => `trains[${String(i)}] = vec4(${train.map(glslFloat).join(', ')});`,
  ),
].join('\n')

const smoothstep = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * How far the sea's surface stands above its rest at a point on it (a
 * point at sea level, in the planet's frame), at a time, seen from an
 * eye: the swell's heave as the water's shader draws it. `depth` is the
 * water under the point, in radii: the swell stands taller running into
 * the shallows and is held still at the shore, as the shader has it, so
 * a ship by a harbour rides the wave drawn there rather than the open
 * sea's. Left out, the water is taken as deep.
 */
export function swellHeaveAt(at: Vec3, seconds: number, eye: Vec3, depth = Infinity): number {
  const length = Math.hypot(at[0], at[1], at[2]) || 1
  const up: Vec3 = [at[0] / length, at[1] / length, at[2] / length]
  // east = normalize(cross((0, 1, 0), up) + (1e-5, 0, 0)), as the shader has it.
  let ex = up[2] + 1e-5
  let ez = -up[0]
  const el = Math.hypot(ex, 0, ez) || 1
  ex /= el
  ez /= el
  // north = cross(up, east), with east's y nought.
  const nx = up[1] * ez
  const ny = up[2] * ex - up[0] * ez
  const nz = -up[1] * ex
  const view = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2])
  const lift = (1 - smoothstep(SWELL_NEAR, SWELL_FAR, view)) * smoothstep(0, 0.0004, depth)
  if (lift <= 0) return 0
  const shoal = 1 + 0.7 * (1 - smoothstep(0, 0.004, depth))
  let heave = 0
  for (const [heading, wavelength, steepness, period] of SWELL_TRAINS) {
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    const dx = c * ex + s * nx
    const dy = s * ny
    const dz = c * ez + s * nz
    const k = (Math.PI * 2) / wavelength
    const phi = k * (at[0] * dx + at[1] * dy + at[2] * dz) - ((Math.PI * 2) / period) * seconds
    heave += (steepness / k) * shoal * lift * Math.sin(phi)
  }
  return heave
}
