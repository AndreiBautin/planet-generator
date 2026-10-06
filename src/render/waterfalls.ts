import * as THREE from 'three'

import { DETAIL_TIME, NOISE } from './detail'
import { PLUME_SUN } from './volcanic'

/** How high the spray off the tallest fall rises, in radii. */
const SPRAY_HEIGHT = 0.0035

/** Puffs of spray at each fall. */
const PUFFS = 16

/**
 * Spray off the foot of each waterfall (generation/waterfalls.ts, placed
 * in the worker: work.ts, `placedFalls`): white
 * mist boiling up out of the plunge pool and drifting off as it thins —
 * the plumes' arrangement (volcanic.ts), low, pale and quick, every puff's
 * rise a function of time in the vertex shader. A child of the ground, so
 * it turns with the planet.
 */
export function spray(placed: Float32Array): THREE.Mesh | undefined {
  const count = Math.floor(placed.length / 5)
  if (count === 0) return undefined
  const sites: number[] = []
  for (let k = 0; k < count; k += 1) {
    const at = Array.from(placed.subarray(k * 5, k * 5 + 3))
    const base = placed[k * 5 + 3] ?? 1
    const drop = placed[k * 5 + 4] ?? 0.5
    for (let puff = 0; puff < PUFFS; puff += 1) {
      const phase = (puff + 0.5) / PUFFS
      const jitter = Math.sin((k * 37 + puff) * 78.233) * 43758.5453
      sites.push(...at, base, drop, phase, jitter - Math.floor(jitter))
    }
  }
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  )
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const buffer = new THREE.InstancedInterleavedBuffer(Float32Array.from(sites), 7, 1)
  quad.setAttribute('sprayAt', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
  quad.setAttribute('sprayBase', new THREE.InterleavedBufferAttribute(buffer, 1, 3))
  quad.setAttribute('sprayDrop', new THREE.InterleavedBufferAttribute(buffer, 1, 4))
  quad.setAttribute('sprayPhase', new THREE.InterleavedBufferAttribute(buffer, 1, 5))
  quad.setAttribute('spraySeed', new THREE.InterleavedBufferAttribute(buffer, 1, 6))
  quad.instanceCount = count * PUFFS
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { sprayTime: DETAIL_TIME, spraySun: PLUME_SUN },
    vertexShader: /* glsl */ `
      uniform float sprayTime;
      uniform vec3 spraySun;
      attribute vec3 sprayAt;
      attribute float sprayBase;
      attribute float sprayDrop;
      attribute float sprayPhase;
      attribute float spraySeed;
      varying vec2 vCorner;
      varying float vAge;
      varying float vSeed;
      varying float vDay;
      varying float vNear;
      void main() {
        vec3 up = normalize(sprayAt);
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
        vec3 north = cross(up, east);
        float age = fract(sprayPhase + sprayTime * 0.09);
        float tall = ${SPRAY_HEIGHT.toFixed(4)} * (0.5 + 0.5 * sprayDrop);
        // Boiling up fast and slowing, spreading out on every side, then
        // drifting off with the air.
        float turn = spraySeed * 6.283;
        vec3 spread = (cos(turn) * east + sin(turn) * north) * sqrt(age) * tall * 0.5;
        vec3 along = up * (sprayBase - tall * 0.15 + sqrt(age) * tall) + spread + east * age * age * tall * 0.6;
        float scale = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        float size = mix(0.0005, 0.0022, sqrt(age)) * (0.6 + 0.4 * sprayDrop) * scale;
        vec4 view = viewMatrix * modelMatrix * vec4(along, 1.0);
        float spin = turn + age * 2.0;
        vec2 corner = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * position.xy;
        view.xy += corner * size;
        vCorner = position.xy;
        vAge = age;
        vSeed = spraySeed;
        vec3 worldUp = normalize((modelMatrix * vec4(up, 0.0)).xyz);
        vDay = smoothstep(-0.05, 0.15, dot(worldUp, normalize(spraySun)));
        // Mist is a thing seen from close by: gone from orbit, where a puff
        // would be a white speck the size of a valley.
        vNear = 1.0 - smoothstep(0.06 * scale, 0.25 * scale, -view.z);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vCorner;
      varying float vAge;
      varying float vSeed;
      varying float vDay;
      varying float vNear;
      ${NOISE}
      void main() {
        float r = length(vCorner);
        float lump = detailNoise(vec3(vCorner * 2.4, vSeed * 13.0)) * 0.6 + detailNoise(vec3(vCorner * 6.0, vSeed * 7.0)) * 0.4;
        float puff = (1.0 - smoothstep(0.05 + 0.45 * lump, 0.9, r)) * smoothstep(0.25, 0.6, lump + 0.25);
        float density = puff * smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.35, 1.0, vAge)) * vNear;
        if (density < 0.01) discard;
        // Bright on top where the sun catches it, the blue of the shade
        // beneath; a cold grey-blue at night.
        float top = 0.75 + 0.25 * smoothstep(-0.8, 0.8, vCorner.y + (lump - 0.5) * 0.8);
        vec3 colour = mix(vec3(0.12, 0.15, 0.2), vec3(0.92, 0.95, 0.98) * top, vDay);
        gl_FragColor = vec4(colour, density * 0.32);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(quad, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  return mesh
}
