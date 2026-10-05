import * as THREE from 'three'

/**
 * Aerial perspective in place of Three's flat fog: the same extinction
 * with distance, but the haze it fades into is lit by the sun — warm and
 * bright looking towards it, cooler and a little dimmer looking away — and
 * distant ground turns towards the sky's colour before it vanishes, which
 * is what makes a far range read as far rather than as fogged.
 *
 * Done by replacing the fog chunks every built-in material includes, so
 * the ground, the sea and the features all take it without each knowing.
 * The sun's direction is a shared uniform object, handed to the materials
 * that compile their own shaders (`onBeforeCompile`); a material that is
 * not handed it reads a zero sun and gets the plain haze, which is the
 * correct fallback rather than a broken one.
 */

/** The sun's direction in view space, scaled by how much of it reaches the air around the eye. */
export const HAZE_SUN = { value: new THREE.Vector3(0, 0, 0) }

let installed = false

export function installHaze(): void {
  if (installed) return
  installed = true
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif`
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 hazeSun;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogDepth = length(vFogView);
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float hazeLit = length(hazeSun);
  vec3 hazeView = normalize(vFogView);
  float sunward = hazeLit > 0.0 ? max(dot(hazeView, hazeSun / hazeLit), 0.0) : 0.0;
  // Forward scattering: a tight bright glow round the sun, a broad warm one.
  float glow = pow(sunward, 24.0) * 1.6 + pow(sunward, 4.0) * 0.35;
  vec3 haze = fogColor * (0.82 + 0.3 * sunward) + vec3(1.0, 0.82, 0.58) * glow * hazeLit * dot(fogColor, vec3(0.33));
  // Distance takes the colour first and the light after: a far range goes
  // blue-grey before it fades out.
  vec3 tinted = mix(gl_FragColor.rgb, gl_FragColor.rgb * normalize(fogColor + 0.05) * 1.7, fogFactor * 0.35);
  gl_FragColor.rgb = mix(tinted, haze, fogFactor);
#endif`
}
