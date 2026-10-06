import * as THREE from 'three'

/**
 * Weather that travels: the cloud map carried by winds that blow one way
 * in the tropics and the other at the middle latitudes, as a world's do,
 * so a storm comes up over the horizon, passes and goes on.
 *
 * Carried as it stands the field would shear without end — two latitudes
 * a little apart drift apart for ever — so it is carried twice, each copy
 * reborn every `FLOW_PERIOD` seconds somewhere new round the world, half a
 * period out of step. Each copy's cloud is worn away from its edges as it
 * nears rebirth (`ERODE`), so the one fading is only its thickest cores;
 * the sky reads as weather forming and clearing, not as two pictures
 * dissolving into each other.
 *
 * Everything that asks where the cloud is reads it through here — the
 * layer, its shadow on the ground, the shafts of rain, the shower over
 * the eye and the lightning — so a storm is where it is drawn.
 */

/** Seconds a copy of the cloud field is carried before it is reborn. */
export const FLOW_PERIOD = 300
/** How much cover a copy loses at rebirth: all of it, so nothing pops; its edges go first, its cores last. */
export const ERODE = 1
/** Strongest wind, in turns of the cloud map per second. */
const WIND = 0.00025

/** A copy's age in seconds, where it was reborn (a share of a turn), and how far it is through its life (0 to 1). */
export interface FlowPhase {
  readonly age: number
  readonly shift: number
  readonly life: number
}

/** The two copies of the cloud field at `seconds`. */
export function flowPhases(seconds: number): readonly [FlowPhase, FlowPhase] {
  const phase = (k: number): FlowPhase => {
    const t = seconds + (k * FLOW_PERIOD) / 2
    const cycle = Math.floor(t / FLOW_PERIOD)
    const age = t - cycle * FLOW_PERIOD
    const h = Math.sin((cycle * 2 + k) * 91.345) * 43758.5453
    return { age, shift: h - Math.floor(h), life: age / FLOW_PERIOD }
  }
  return [phase(0), phase(1)]
}

/**
 * The wind at a row of the cloud map, `v` 0 at the south pole to 1 at the
 * north, in turns per second: easterly in the tropics, westerly at the
 * middle latitudes, easterly again round the poles.
 */
export function windAt(v: number): number {
  const latitude = (v - 0.5) * Math.PI
  return -Math.cos(latitude * 4) * WIND
}

/** How much a copy is worn away at `life` through its life. */
export function erosion(life: number): number {
  // Strongest at birth and death, none through the middle of its life.
  const w = 1 - Math.abs(2 * life - 1)
  const t = Math.min(1, w / 0.5)
  return ERODE * (1 - t * t * (3 - 2 * t))
}

/** The cover the two copies make together, from each one's own reading. */
export function blendCover(first: number, second: number, phases: readonly FlowPhase[]): number {
  return Math.max(0, first - erosion(phases[0]?.life ?? 0), second - erosion(phases[1]?.life ?? 0))
}

/** How heavy the cloud is over a direction in the cloud layer's frame, as it is drawn at `seconds`. */
export function flowingCoverAt(
  data: Uint8Array,
  width: number,
  direction: readonly [number, number, number],
  seconds: number,
): number {
  const phases = flowPhases(seconds)
  const [x, y, z] = direction
  const length = Math.hypot(x, y, z) || 1
  const v = 1 - Math.acos(Math.max(-1, Math.min(1, y / length))) / Math.PI
  const read = (phase: FlowPhase): number => {
    const turn = -(windAt(v) * phase.age + phase.shift) * Math.PI * 2
    return coverAt(data, width, turned([x, y, z], turn))
  }
  return blendCover(read(phases[0]), read(phases[1]), phases)
}

/** A direction turned about the axis by `angle`, the way the map's u grows. */
function turned(d: readonly [number, number, number], angle: number): [number, number, number] {
  const a = Math.atan2(d[2], -d[0]) + angle
  const r = Math.hypot(d[0], d[2])
  return [-Math.cos(a) * r, d[1], Math.sin(a) * r]
}

/** The two copies, for the shaders: (age, shift) of each. */
export const CLOUD_FLOW = { value: new THREE.Vector4() }
/** And how far through its life each is. */
export const CLOUD_FLOW_LIFE = { value: new THREE.Vector2() }

/** Set the shaders' copies for `seconds`, as the page reads them. */
export function updateFlow(seconds: number): void {
  const [a, b] = flowPhases(seconds)
  CLOUD_FLOW.value.set(a.age, a.shift, b.age, b.shift)
  CLOUD_FLOW_LIFE.value.set(a.life, b.life)
}

/**
 * The same in GLSL. Needs `uniform vec4 cloudFlow` and `uniform vec2
 * cloudFlowLife` declared. `flowUv(uv, k)` is where copy `k` reads the
 * map for a point drawn at `uv`; `flowBlend` puts the two readings together.
 */
export const FLOW_GLSL = /* glsl */ `
  float flowWind(float v) {
    return -cos((v - 0.5) * 3.1415927 * 4.0) * ${WIND.toFixed(6)};
  }
  vec2 flowUv(vec2 uv, int k) {
    vec2 phase = k == 0 ? cloudFlow.xy : cloudFlow.zw;
    return vec2(uv.x - flowWind(uv.y) * phase.x - phase.y, uv.y);
  }
  float flowErosion(float life) {
    float w = 1.0 - abs(2.0 * life - 1.0);
    return ${ERODE.toFixed(3)} * (1.0 - smoothstep(0.0, 0.5, w));
  }
  float flowBlend(float first, float second) {
    return max(0.0, max(first - flowErosion(cloudFlowLife.x), second - flowErosion(cloudFlowLife.y)));
  }
`

/**
 * How heavy the cloud is over a point, 0 to 1, read off the baked cloud
 * map: the same map the layer is drawn from and the ground is shaded by.
 * `direction` is in the cloud layer's own frame.
 */
export function coverAt(
  data: Uint8Array,
  width: number,
  direction: readonly [number, number, number],
): number {
  const height = width / 2
  if (height < 1 || data.length < width * height * 4) return 0
  const [x, y, z] = direction
  const u = Math.atan2(z, -x) / (Math.PI * 2) + 0.5
  const v = 1 - Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI
  const col = ((Math.floor(u * width) % width) + width) % width
  const row = Math.min(height - 1, Math.max(0, Math.floor(v * height)))
  return (data[(row * width + col) * 4] ?? 0) / 255
}
