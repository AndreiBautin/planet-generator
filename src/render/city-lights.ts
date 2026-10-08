import * as THREE from 'three'

import { VALLEY_FOG } from './valley-fog'

/**
 * The lights of a lived-on world at night (generation/settlements.ts):
 * points standing on the ground, warm or cold white, twinkling a little,
 * lit only where it is dark — fading in through the dusk — so the night
 * side shows the towns, the coasts they crowd and the roads between them.
 * A child of the ground, so they turn with it.
 *
 * From far off the ground is drawn from coarse patches that can stand a
 * little above the true ground; each light is lifted in proportion to how
 * far off it is seen, so a town is not swallowed by the coarse hill drawn
 * over it, and sits on the ground again as the eye comes down.
 */
export function cityLights(placed: Float32Array): THREE.Points | undefined {
  const count = Math.floor(placed.length / 5)
  if (count === 0) return undefined
  const positions = new Float32Array(count * 3)
  const looks = new Float32Array(count * 2)
  for (let k = 0; k < count; k += 1) {
    positions[k * 3] = placed[k * 5] ?? 0
    positions[k * 3 + 1] = placed[k * 5 + 1] ?? 0
    positions[k * 3 + 2] = placed[k * 5 + 2] ?? 1
    looks[k * 2] = placed[k * 5 + 3] ?? 0.5
    looks[k * 2 + 1] = placed[k * 5 + 4] ?? 0.8
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('cityLook', new THREE.BufferAttribute(looks, 2))
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { citySun: VALLEY_FOG.sun, cityScale: VALLEY_FOG.shape },
    vertexShader: /* glsl */ `
      uniform vec3 citySun;
      uniform vec4 cityScale;
      attribute vec2 cityLook;
      varying float vGlow;
      varying float vWarm;
      void main() {
        vec3 up = normalize(position);
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 worldUp = normalize((modelMatrix * vec4(up, 0.0)).xyz);
        float away = distance(world, cameraPosition) / max(cityScale.z, 1e-4);
        world += worldUp * min(0.006, away * 0.004) * cityScale.z;
        // Dark enough to need them: on through the dusk, off by day.
        float dark = 1.0 - smoothstep(-0.12, 0.04, dot(worldUp, normalize(citySun)));
        vGlow = cityLook.x * dark;
        vWarm = cityLook.y;
        vec4 view = viewMatrix * vec4(world, 1.0);
        // A spark from afar, a little larger close to, never a blob. Never
        // under about two and a half pixels, though: from orbit a 1.3 px
        // point snapped between one pixel and parts of two as the planet
        // turned, and every town twinkled, the bloom making it worse. The
        // light it would have had is kept by dimming it as it is widened.
        float wanted = clamp(2.2 / max(away, 0.02) * 0.06, 1.3, 3.2);
        gl_PointSize = max(wanted, 2.6);
        vGlow *= (wanted * wanted) / (gl_PointSize * gl_PointSize);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      varying float vWarm;
      void main() {
        if (vGlow < 0.01) discard;
        float spot = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        vec3 colour = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.62, 0.25), vWarm);
        gl_FragColor = vec4(colour * vGlow * spot * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 1
  return points
}
