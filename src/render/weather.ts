import * as THREE from 'three'

import { CLOUD_RADIUS } from './clouds'
import { DETAIL_TIME, LIGHTNING } from './detail'
import { coverAt } from './rain'

/**
 * Weather you can see coming: storm cells under the heaviest cloud, with
 * grey shafts of rain hanging from them to the ground and lightning
 * flickering inside them now and then.
 *
 * Everything is read off the baked cloud map — the same map the layer is
 * drawn from, the ground shaded by, and the shower over the eye decided
 * by — so a storm is where the cloud is thick, and nowhere else.
 */

/** Cover above which the cloud is a storm. */
const STORM = 0.82
/** The most shafts a planet carries: enough for a few storms in view, little enough for a phone. */
const MOST_SHAFTS = 700

/** A direction from a texel of the cloud map, as `coverAt` reads it. */
function texelDirection(col: number, row: number, width: number): [number, number, number] {
  const height = width / 2
  const angle = ((col + 0.5) / width - 0.5) * Math.PI * 2
  const polar = (1 - (row + 0.5) / height) * Math.PI
  const r = Math.sin(polar)
  return [-Math.cos(angle) * r, Math.cos(polar), Math.sin(angle) * r]
}

/**
 * Shafts of rain under the storm cells: tall quads from the cloud base to
 * the ground, each turned to face the eye about its own vertical, streaked
 * and drifting. A child of the cloud layer, so they move with the storms.
 * Faded out close by (the shower over the eye takes over there) and far
 * off (from orbit a storm is its cloud), so they are a thing seen across
 * the land from a glide.
 */
export function rainShafts(data: Uint8Array, width: number): THREE.Mesh {
  const height = width / 2
  const sites: number[] = []
  let h = 2166136261
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296
  }
  const candidates: number[] = []
  for (let row = 1; row < height - 1; row += 2) {
    for (let col = 0; col < width; col += 2) {
      const cover = (data[(row * width + col) * 4] ?? 0) / 255
      if (cover > STORM) candidates.push(col, row, cover)
    }
  }
  const keep = Math.min(1, MOST_SHAFTS / Math.max(1, candidates.length / 3))
  for (let k = 0; k < candidates.length; k += 3) {
    if (next() > keep) continue
    const col = (candidates[k] ?? 0) + next() * 2 - 0.5
    const row = (candidates[k + 1] ?? 0) + next() * 2 - 0.5
    const heavy = ((candidates[k + 2] ?? STORM) - STORM) / (1 - STORM)
    sites.push(...texelDirection(col, row, width), 0.004 + heavy * 0.006, next())
  }
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3),
  )
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const buffer = new THREE.InstancedInterleavedBuffer(Float32Array.from(sites), 5, 1)
  quad.setAttribute('shaftAt', new THREE.InterleavedBufferAttribute(buffer, 3, 0))
  quad.setAttribute('shaftWidth', new THREE.InterleavedBufferAttribute(buffer, 1, 3))
  quad.setAttribute('shaftSeed', new THREE.InterleavedBufferAttribute(buffer, 1, 4))
  quad.instanceCount = sites.length / 5
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      shaftTime: DETAIL_TIME,
      shaftLight: SHAFT_LIGHT,
      lightning: LIGHTNING,
    },
    vertexShader: /* glsl */ `
      attribute vec3 shaftAt;
      attribute float shaftWidth;
      attribute float shaftSeed;
      varying vec2 vShaft;
      varying float vSeed;
      varying float vFar;
      varying vec3 vDir;
      void main() {
        vec3 up = normalize(shaftAt);
        // From a little under the ground (hills stand above radius one)
        // to just under the cloud base.
        vec3 along = up * mix(0.998, ${(CLOUD_RADIUS - 0.002).toFixed(4)}, position.y);
        vec3 world = (modelMatrix * vec4(along, 1.0)).xyz;
        vec3 worldUp = normalize((modelMatrix * vec4(up, 0.0)).xyz);
        vec3 toEye = cameraPosition - world;
        vec3 side = normalize(cross(worldUp, toEye));
        float scale = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        world += side * position.x * shaftWidth * scale;
        float away = length(toEye) / scale;
        vFar = smoothstep(0.015, 0.05, away) * (1.0 - smoothstep(0.35, 0.7, away));
        vShaft = vec2(position.x, position.y);
        vSeed = shaftSeed;
        vDir = up;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float shaftTime;
      uniform vec3 shaftLight;
      uniform vec4 lightning;
      varying vec2 vShaft;
      varying float vSeed;
      varying float vFar;
      varying vec3 vDir;
      float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      void main() {
        // Soft at the sides, heaviest just under the cloud, thinning to the
        // ground, and streaked: curtains of rain, not a solid column.
        float across = 1.0 - smoothstep(0.35, 1.0, abs(vShaft.x));
        float down = smoothstep(0.0, 0.25, vShaft.y) * (1.0 - smoothstep(0.85, 1.0, vShaft.y));
        float lane = floor((vShaft.x * 0.5 + 0.5) * 9.0 + vSeed * 31.0);
        float streak = 0.55 + 0.45 * hash(lane) * (0.6 + 0.4 * sin(vShaft.y * 18.0 + shaftTime * 3.0 + lane));
        float a = across * down * streak * vFar * 0.32;
        if (a < 0.003) discard;
        float flash = lightning.w * exp(-pow(acos(clamp(dot(normalize(vDir), lightning.xyz), -1.0, 1.0)) / 0.03, 2.0));
        gl_FragColor = vec4(shaftLight * (0.55 + 0.25 * vShaft.y) + vec3(0.8, 0.82, 1.0) * flash, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(quad, material)
  // Culled by nothing: the instances span the planet, the quad does not.
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  return mesh
}

/** The light a shaft is seen in: the sky's, set by the scene each frame. */
export const SHAFT_LIGHT = { value: new THREE.Color(0.6, 0.62, 0.68) }

/**
 * Lightning: now and then, in a storm near the eye, a flash — two quick
 * flickers, a quarter of a second — lighting the cloud from inside and the
 * land under it. Decided by the clock and a hash of it, so the recorder
 * sees the same storm every run.
 */
export class Lightning {
  private nextAt = 0
  private startedAt = -1e9
  private readonly where = new THREE.Vector3(0, 1, 0)
  /** Counted up at every strike, so a listener can tell a new one; and how far from the eye it was, radians. */
  strikes = 0
  lastAngle = 0

  /**
   * `eye` is the camera's direction in the cloud layer's frame, `low` how
   * far it is in the weather (1 low down, 0 from orbit). Returns how bright
   * the flash on the land is now, 0 to 1.
   */
  update(
    seconds: number,
    eye: readonly [number, number, number],
    low: number,
    data: Uint8Array | undefined,
    width: number,
  ): number {
    if (seconds >= this.nextAt) {
      const roll = fract(Math.sin(Math.floor(seconds * 10) * 12.9898) * 43758.5453)
      this.nextAt = seconds + 2.5 + roll * 7
      if (data !== undefined && low > 0) {
        // A storm within a few degrees of the eye, if there is one.
        for (let k = 0; k < 8; k += 1) {
          const a = fract(Math.sin((seconds + k) * 78.233) * 43758.5453) * Math.PI * 2
          const d = 0.02 + fract(Math.sin((seconds - k) * 39.425) * 43758.5453) * 0.12
          const p = offsetFrom(eye, a, d)
          if (coverAt(data, width, p) > STORM + 0.04) {
            this.where.set(...p)
            this.startedAt = seconds
            this.strikes += 1
            this.lastAngle = d
            break
          }
        }
      }
    }
    const t = seconds - this.startedAt
    const strength =
      t < 0 || t > 0.5 ? 0 : Math.exp(-t * 14) + (t > 0.13 ? 0.7 * Math.exp(-(t - 0.13) * 16) : 0)
    LIGHTNING.value.set(this.where.x, this.where.y, this.where.z, Math.min(1, strength) * low)
    return Math.min(1, strength) * low
  }
}

const fract = (x: number): number => x - Math.floor(x)

/** A direction `distance` radians from `from`, setting off at `angle` round it. */
function offsetFrom(
  from: readonly [number, number, number],
  angle: number,
  distance: number,
): [number, number, number] {
  const [x, y, z] = from
  const length = Math.hypot(x, y, z) || 1
  const u: [number, number, number] = [x / length, y / length, z / length]
  const helper: [number, number, number] = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a: [number, number, number] = [
    u[1] * helper[2] - u[2] * helper[1],
    u[2] * helper[0] - u[0] * helper[2],
    u[0] * helper[1] - u[1] * helper[0],
  ]
  const al = Math.hypot(...a) || 1
  const e1: [number, number, number] = [a[0] / al, a[1] / al, a[2] / al]
  const e2: [number, number, number] = [
    u[1] * e1[2] - u[2] * e1[1],
    u[2] * e1[0] - u[0] * e1[2],
    u[0] * e1[1] - u[1] * e1[0],
  ]
  const c = Math.cos(distance)
  const s = Math.sin(distance)
  return [
    u[0] * c + (e1[0] * Math.cos(angle) + e2[0] * Math.sin(angle)) * s,
    u[1] * c + (e1[1] * Math.cos(angle) + e2[1] * Math.sin(angle)) * s,
    u[2] * c + (e1[2] * Math.cos(angle) + e2[2] * Math.sin(angle)) * s,
  ]
}
