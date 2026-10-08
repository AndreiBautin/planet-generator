import * as THREE from 'three'

/**
 * Moonlight: the brightest moon in the sky lights the night side, shaded
 * by its direction and dimmed by its phase, so a hillside at night has a
 * lit slope and a dark one rather than one flat floor of ambient.
 *
 * Not a second three.js light: every custom material here cuts the sun's
 * direct light past the terminator (`groundDay`, `treeDay`, …), which
 * would cut a second directional light with it. The moon is a uniform —
 * its direction in view space and its strength — and a term each material
 * adds after its own lighting, at `aomap_fragment`, which follows
 * `lights_fragment_end` in every three shader and which nothing else here
 * replaces.
 */

/** xyz: the moon's direction in view space; w: its light, 0 by day. */
export const MOON_LIGHT = { value: new THREE.Vector4(0, 1, 0, 0) }

/** Moonlight's colour: the sun's light off grey rock, read as cool silver against the warm town lights. */
export const MOON_COLOUR: readonly [number, number, number] = [0.6, 0.72, 1.0]

/**
 * The strongest moonlight, against the sun's 3.2: a full, big moon high
 * in the sky. Far more than a real moon's share of the sun, on purpose:
 * at 0.42 a moonlit hillside measured no brighter than a moonless one;
 * at 1.5 it read as moonlight (a frame's lower half at luma 21 of 255).
 */
export const MOON_STRENGTH = 1.6

export interface MoonSeen {
  /** The moon's direction from the planet's centre, unit. */
  readonly direction: readonly [number, number, number]
  /** Its radius in planet radii. */
  readonly radius: number
}

/**
 * Which moon lights the night and how much: the lit fraction of each
 * (full when opposite the sun, new beside it) weighed by its size, the
 * brightest taken, and all of it put out while the sun is up (`night`,
 * 0 by day to 1 in full dark). Pure, so a test holds the phases.
 */
export function moonlightOf(
  moons: readonly MoonSeen[],
  sun: readonly [number, number, number],
  night: number,
  up: readonly [number, number, number] = [0, 0, 0],
): { readonly direction: readonly [number, number, number]; readonly strength: number } {
  let best = 0
  let direction: readonly [number, number, number] = [0, 1, 0]
  for (const moon of moons) {
    const d = moon.direction
    const lit = (1 - (d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2])) / 2
    // And only once risen over the eye's horizon (`up`, the eye's own
    // direction from the planet's centre; none given, every moon counts).
    const over = d[0] * up[0] + d[1] * up[1] + d[2] * up[2]
    const risen =
      up[0] === 0 && up[1] === 0 && up[2] === 0 ? 1 : Math.max(0, Math.min(1, (over + 0.05) / 0.2))
    const strength = lit * lit * Math.min(1, moon.radius / 0.1) * risen
    if (strength > best) {
      best = strength
      direction = d
    }
  }
  return { direction, strength: best * MOON_STRENGTH * Math.max(0, Math.min(1, night)) }
}

/** Add the moon's light to a material's lighting; call after the material's own shader patches. */
export function withMoonlight(shader: {
  uniforms: Record<string, THREE.IUniform>
  fragmentShader: string
}): void {
  // Once only: a house is weathered and a town, and both ask.
  if (shader.uniforms.moonLight !== undefined) return
  shader.uniforms.moonLight = MOON_LIGHT
  shader.fragmentShader =
    'uniform vec4 moonLight;\n' +
    shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      /* glsl */ `{
      // The moon (moonlight.ts): wrapped a little, as its light is soft
      // after the air, and added after the sun's has been cut at the
      // terminator.
      float moonFacing = dot(normal, moonLight.xyz);
      float moonLit = mix(max(moonFacing, 0.0), max((moonFacing + 0.3) / 1.3, 0.0), 0.5);
      // Most of the surface's own colour taken out: the eye sees little
      // colour by moonlight, and a hillside lit green read as a dim day.
      vec3 moonAlbedo = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), 0.7);
      reflectedLight.directDiffuse += moonAlbedo * vec3(${MOON_COLOUR.map((c) => c.toFixed(2)).join(', ')}) * moonLight.w * moonLit * RECIPROCAL_PI;
    }
    #include <aomap_fragment>`,
    )
}
