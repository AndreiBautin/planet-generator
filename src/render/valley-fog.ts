import * as THREE from 'three'

/**
 * Mist at dawn: a layer lying over the low ground — the valleys, the lake
 * basins, the coastal plains — that thickens through the small hours,
 * lies thickest round sunrise, and burns off by the middle of the morning.
 * The ridges stand out of it.
 *
 * Drawn on what it covers rather than as a volume of its own: every
 * surface under the layer (ground, water, trees) is mixed towards the
 * mist's colour by how much of the line of sight to it runs through the
 * layer. Seen from above that is the depth of mist over the ground, so a
 * valley fills white and a ridge stays clear; seen from inside it is the
 * distance, so the far side of a valley goes first.
 *
 * The hour is each point's own, read from where it lies against the sun
 * (the same rule as `ui/postcard.ts`'s `hourAt`), so it is dawn along one
 * line of the planet at a time and the mist sweeps round with the day.
 */
export const VALLEY_FOG = {
  /** x: how far the top sinks away from dawn, radii; y: density, per radius; z: the planet's scale; w: 1 on, 0 off. */
  shape: { value: new THREE.Vector4(0.0008, 380, 1, 1) },
  /** The sun's direction in the room. */
  sun: { value: new THREE.Vector3(1, 0, 0) },
  /** The mist in the sun: the sunlight as it reaches the ground. */
  light: { value: new THREE.Color(1, 0.95, 0.9) },
  /** The mist out of the sun: the sky's light. */
  shade: { value: new THREE.Color(0.3, 0.35, 0.45) },
}

const DECLARE_VERTEX = /* glsl */ `
varying vec3 vValleyFogWorld;
varying float vValleyFogTop;
`

const DECLARE_FRAGMENT = /* glsl */ `
uniform vec4 valleyFogShape;
uniform vec3 valleyFogSun;
uniform vec3 valleyFogLight;
uniform vec3 valleyFogShade;
varying vec3 vValleyFogWorld;
varying float vValleyFogTop;
// How much mist lies between the eye and this point, 0 to 1, and its colour.
float valleyFogAt(vec3 world, float depth, out vec3 colour) {
  colour = vec3(0.0);
  if (valleyFogShape.w <= 0.0) return 0.0;
  vec3 p = world / valleyFogShape.z;
  vec3 c = cameraPosition / valleyFogShape.z;
  vec3 up = normalize(p);
  // The local hour: noon under the sun, morning on the side turning towards it.
  float turn = atan(up.x, up.z) - atan(valleyFogSun.x, valleyFogSun.z);
  turn = mod(turn + 3.14159265, 6.2831853) - 3.14159265;
  float hour = 12.0 + turn * 3.81971863;
  float dawn = smoothstep(1.5, 5.0, hour) * (1.0 - smoothstep(8.0, 10.5, hour));
  if (dawn <= 0.0) return 0.0;
  // The layer's top rolls, broadly and in finer wisps, so it does not lie
  // along one contour or read as a flat sheet.
  float roll = sin(up.x * 61.0 + up.y * 17.0) * sin(up.z * 53.0 - up.y * 29.0) * 0.6 +
    sin(up.x * 233.0 - up.z * 151.0) * sin(up.y * 197.0 + up.x * 89.0) * 0.4;
  float here = length(p);
  float top = here + depth + 0.0009 * roll - valleyFogShape.x * (1.0 - dawn);
  float eye = length(c);
  float far = distance(p, c);
  // How far the sight line runs through the mist on its way out from this
  // point: the depth of mist over it, stretched by how shallowly the line
  // climbs; the whole line when the eye is in the mist too.
  float climb = max(dot((c - p) / max(far, 1e-6), up), 0.06);
  float through = eye < top ? far : min(far, max(0.0, top - here) / climb);
  // Never quite opaque, and soft at its edge where it thins to nothing.
  // And a thing of the low flight: from high up and from orbit it fades,
  // where a few thousandths of a radius of mist is a grey stain.
  float near = 1.0 - smoothstep(0.05, 0.16, eye - 1.0);
  float amount = (1.0 - exp(-through * valleyFogShape.y)) * 0.62 * dawn * near;
  float lit = smoothstep(-0.03, 0.1, dot(up, valleyFogSun));
  colour = mix(valleyFogShade, valleyFogLight, lit);
  return amount;
}
`

/**
 * Lay the mist over a Three material's output: call from inside its
 * `onBeforeCompile`, naming the attribute that carries the mist's depth,
 * and how deep the mist is over the vertex drawn when that is not the
 * attribute itself.
 */
export function withValleyFog(
  shader: THREE.WebGLProgramParametersWithUniforms,
  depth: string,
  over = depth,
): void {
  shader.uniforms.valleyFogShape = VALLEY_FOG.shape
  shader.uniforms.valleyFogSun = VALLEY_FOG.sun
  shader.uniforms.valleyFogLight = VALLEY_FOG.light
  shader.uniforms.valleyFogShade = VALLEY_FOG.shade
  shader.vertexShader = (
    `attribute float ${depth};\n` +
    DECLARE_VERTEX +
    shader.vertexShader
  ).replace(
    '#include <project_vertex>',
    `#include <project_vertex>\n  vValleyFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vValleyFogTop = ${over};`,
  )
  shader.fragmentShader = (DECLARE_FRAGMENT + shader.fragmentShader).replace(
    '#include <opaque_fragment>',
    /* glsl */ `#include <opaque_fragment>
  {
    vec3 mistColour;
    float mist = valleyFogAt(vValleyFogWorld, vValleyFogTop, mistColour);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mistColour, mist);
    gl_FragColor.a = mix(gl_FragColor.a, 1.0, mist);
  }`,
  )
}
