import * as THREE from 'three'

/**
 * Three's soft shadow filter, made steady.
 *
 * It turns its five samples by a different angle at every pixel (an
 * interleaved gradient noise), which is meant to be smoothed over frames by
 * temporal anti-aliasing. There is none here, so every shadow edge drew as a
 * speckle, and the speckle crawled as the sun moved over the turning planet
 * and the eye moved over the ground: the static over forests. The samples
 * now sit at one fixed angle everywhere.
 *
 * And the shadows fade out towards the edge of the box they are drawn in,
 * rather than stopping at a line that travels with the eye.
 *
 * Returns whether both changes took: a three.js upgrade that renames the
 * code they key on leaves its own filter in place rather than breaking it.
 */
let installed: boolean | undefined

export function installSteadyShadows(): boolean {
  if (installed !== undefined) return installed
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment
  const noise = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;'
  const ending = 'return mix( 1.0, shadow, shadowIntensity );'
  if (!chunk.includes(noise) || !chunk.includes(ending)) {
    installed = false
    return installed
  }
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replaceAll(noise, 'float phi = 0.7;').replace(
    ending,
    /* glsl */ `float shadowEdge = max(abs(shadowCoord.x * 2.0 - 1.0), abs(shadowCoord.y * 2.0 - 1.0));
			return mix( 1.0, shadow, shadowIntensity * (1.0 - smoothstep(0.7, 0.97, shadowEdge)) );`,
  )
  installed = true
  return installed
}
