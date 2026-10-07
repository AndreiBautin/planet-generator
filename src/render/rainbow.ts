import * as THREE from 'three'

/**
 * A rainbow: the bow of light seen with the sun at your back and rain in
 * front of you, round the point straight away from the sun — red outside,
 * violet in — with a faint second bow outside it, its colours the other
 * way round, the sky a little brighter inside the first.
 *
 * **Drawn at 26 degrees, not the true 42.** The view is 45 degrees tall
 * and a glide looks a little down, so a true bow ringed the whole screen
 * and showed only in its corners: measured, its twelve points round the
 * ring all fell off the frame. At 26 its arch stands over the horizon in
 * view, which is what a rainbow is for.
 *
 * Drawn on a sphere round the eye, a few hundredths of a radius out, with
 * the depth test on: a hill nearer than the rain hides the bow's foot, and
 * the far hills are behind the rain, which is where a rainbow stands.
 */

/** How far out the rain the bow is drawn on stands, in radii. */
const OUT = 0.03
/** How many seconds the bow takes to come and go. */
const EASE = 1.6

export interface RainbowSky {
  /** The sun's height over the eye's horizon, the cosine of its angle from straight up. */
  readonly sunUp: number
  /** The eye's height over the sea, in radii. */
  readonly height: number
  /** How heavy the cloud is away from the sun, out where the bow would stand, 0 to 1. */
  readonly rainAway: number
  /** How heavy the cloud is over the eye, 0 to 1: under it the sun is not shining. */
  readonly cloudOver: number
}

/**
 * How bright a rainbow is, 0 to 1. The sun has to be up and low — any
 * higher than the bow is wide and the bow is under the horizon, and it is brightest with the
 * sun low — the eye near the ground, rain on the far side from the sun, and
 * the sun on the eye, not hidden by the cloud overhead.
 */
export function rainbowStrength(sky: RainbowSky): number {
  // Past about 26 degrees high (the drawn bow's own radius) it is under the horizon.
  const low = smooth(0.0, 0.08, sky.sunUp) * (1 - smooth(0.3, 0.44, sky.sunUp))
  const near = 1 - smooth(0.03, 0.08, sky.height)
  const rain = smooth(0.35, 0.6, sky.rainAway)
  const sunlit = 1 - smooth(0.45, 0.72, sky.cloudOver)
  return low * near * rain * sunlit
}

export class Rainbow {
  readonly object: THREE.Mesh
  private readonly away = { value: new THREE.Vector3(0, 0, 1) }
  private readonly up = { value: new THREE.Vector3(0, 1, 0) }
  private readonly strength = { value: 0 }
  private last: number | undefined

  constructor() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: { bowAway: this.away, bowUp: this.up, bowStrength: this.strength },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 bowAway;
        uniform vec3 bowUp;
        uniform float bowStrength;
        varying vec3 vWorld;
        // A hue, violet at 0 to red at 1.
        vec3 spectrum(float t) {
          float h = (1.0 - clamp(t, 0.0, 1.0)) * 0.78;
          return clamp(vec3(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), 0.0, 1.0);
        }
        void main() {
          vec3 look = normalize(vWorld - cameraPosition);
          float angle = degrees(acos(clamp(dot(look, bowAway), -1.0, 1.0)));
          // The first bow, violet at 25 degrees to red at 27.
          float t = (angle - 25.0) / 2.0;
          float first = smoothstep(-0.25, 0.1, t) * (1.0 - smoothstep(0.9, 1.25, t));
          // The second, fainter and wider, its colours reversed.
          float u = (angle - 32.0) / 3.0;
          float second = smoothstep(-0.2, 0.1, u) * (1.0 - smoothstep(0.9, 1.2, u)) * 0.35;
          // Inside the first bow the sky is a little brighter.
          float inside = (1.0 - smoothstep(18.0, 25.0, angle)) * smoothstep(10.0, 20.0, angle) * 0.06;
          // Softer than a pure spectrum: rain light, not a test card.
          vec3 light = mix(spectrum(t), vec3(0.8), 0.3) * first + mix(spectrum(1.0 - u), vec3(0.8), 0.4) * second + vec3(inside);
          // Fading to its feet as it nears the horizon: the sphere it is
          // drawn on meets the sea a few hundredths out, and the bow ended
          // there in a hard line across the water.
          float lift = dot(look, bowUp);
          float feet = smoothstep(-0.13, -0.03, lift);
          gl_FragColor = vec4(light * bowStrength * feet * 0.38, 1.0);
        }
      `,
    })
    this.object = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material)
    this.object.frustumCulled = false
    this.object.renderOrder = 4
    this.object.visible = false
  }

  /**
   * At the eye, `away` the direction straight from the sun, in the room;
   * `strength` from `rainbowStrength`; `scale` the planet's size; `seconds`
   * the clock. The bow eases towards the strength over a couple of
   * seconds: read straight off the cloud under a fast glide it came and
   * went in a second, which reads as a flash rather than weather.
   */
  update(
    eye: THREE.Vector3,
    away: THREE.Vector3,
    strength: number,
    scale: number,
    seconds: number,
  ): void {
    const step = this.last === undefined ? 1 : Math.min(1, Math.max(0, seconds - this.last) / EASE)
    this.last = seconds
    this.strength.value += (strength - this.strength.value) * step
    this.object.visible = this.strength.value > 0.01
    if (!this.object.visible) return
    this.away.value.copy(away).normalize()
    this.up.value.copy(eye).normalize()
    this.object.position.copy(eye)
    this.object.scale.setScalar(OUT * scale)
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}

const smooth = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
