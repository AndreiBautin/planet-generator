import * as THREE from 'three'

import { DETAIL_TIME } from './detail'

/**
 * Rain: a shower of streaks around the eye, falling along the planet's up,
 * drawn only where the cloud over the eye is heavy. One set of lines whose
 * fall is a function of time in the vertex shader, so nothing is moved on
 * the page frame by frame; the whole thing is placed at the eye and turned
 * to the local up once a frame.
 *
 * It is weather you fly through, not weather you see from orbit: the box
 * is a few hundredths of a radius across and the streaks fade with the
 * cover, so a clear sky has none and a grey one has a downpour.
 */
const STREAKS = 1600
const FLAKES = 4800
/** Half the box the streaks fall in, in planet radii. */
const RADIUS = 0.006
const HEIGHT = 0.012

export class Rain {
  /** The streaks of rain and the flakes of snow, one shown at a time. */
  readonly object = new THREE.Group()
  private readonly streaks: THREE.LineSegments
  private readonly flakes: THREE.Points
  private readonly strength: { value: number }
  private readonly snow = { value: 0 }
  private readonly up = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private static readonly Y = new THREE.Vector3(0, 1, 0)

  constructor() {
    const seeds = new Float32Array(STREAKS * 2 * 3)
    const tails = new Float32Array(STREAKS * 2)
    let h = 12345
    const next = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296
    }
    for (let at = 0; at < STREAKS; at += 1) {
      const x = next() * 2 - 1
      const y = next()
      const z = next() * 2 - 1
      for (const end of [0, 1]) {
        const v = at * 2 + end
        seeds[v * 3] = x
        seeds[v * 3 + 1] = y
        seeds[v * 3 + 2] = z
        tails[v] = end
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
    geometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HEIGHT)
    this.strength = { value: 0 }
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        rainTime: DETAIL_TIME,
        rainStrength: this.strength,
        rainSnow: this.snow,
      },
      vertexShader: /* glsl */ `
        uniform float rainTime;
        uniform float rainStrength;
        uniform float rainSnow;
        attribute float tail;
        varying float vSnow;
        varying float vFade;
        void main() {
          // Each streak falls its own column at its own pace, wrapping
          // round the box; the tail end trails a little above the head.
          // Snow falls a fifth as fast, in short flakes rather than
          // streaks, and drifts from side to side as it comes down.
          float pace = (0.55 + fract(position.x * 7.31 + position.z * 3.17) * 0.35) * mix(1.0, 0.18, rainSnow);
          float drop = fract(position.y - rainTime * pace);
          float y = (0.5 - drop) * ${HEIGHT.toFixed(4)} + tail * ${(HEIGHT * 0.05).toFixed(5)} * mix(1.0, 0.08, rainSnow);
          float sway = sin(rainTime * 1.3 + position.z * 20.0 + position.y * 9.0) * 0.0005 * rainSnow;
          vec3 local = vec3(position.x * ${RADIUS.toFixed(4)} + sway, y, position.z * ${RADIUS.toFixed(4)} + sway * 0.6);
          vSnow = rainSnow;
          vec4 view = modelViewMatrix * vec4(local, 1.0);
          // Fainter at the tail and at the edge of the box.
          float edge = 1.0 - smoothstep(0.6, 1.0, length(position.xz));
          vFade = (1.0 - tail * 0.8) * edge * rainStrength;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vFade;
        varying float vSnow;
        void main() {
          gl_FragColor = vec4(mix(vec3(0.52, 0.6, 0.74), vec3(0.95), vSnow), vFade * mix(0.45, 0.85, vSnow));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.streaks = new THREE.LineSegments(geometry, material)
    this.streaks.frustumCulled = false
    this.streaks.renderOrder = 3
    // Snow as flakes, a few pixels each: as a line a hair long, a flake was
    // a single pixel, and snow on a frozen world was never seen on screen.
    // Three times as many as the streaks: a flake is a dot where a streak is
    // a line, and at the rain's count snow read as a few stars.
    const flakeSeeds = new Float32Array(FLAKES * 3)
    for (let at = 0; at < FLAKES; at += 1) {
      flakeSeeds[at * 3] = next() * 2 - 1
      flakeSeeds[at * 3 + 1] = next()
      flakeSeeds[at * 3 + 2] = next() * 2 - 1
    }
    const flakeGeometry = new THREE.BufferGeometry()
    flakeGeometry.setAttribute('position', new THREE.BufferAttribute(flakeSeeds, 3))
    this.flakes = new THREE.Points(
      flakeGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { rainTime: DETAIL_TIME, rainStrength: this.strength },
        vertexShader: /* glsl */ `
          uniform float rainTime;
          uniform float rainStrength;
          varying float vFade;
          void main() {
            // Drifting down at a fifth of the rain's pace, each its own way,
            // swaying as it falls.
            float pace = (0.55 + fract(position.x * 7.31 + position.z * 3.17) * 0.35) * 0.16;
            float drop = fract(position.y - rainTime * pace);
            float y = (0.5 - drop) * ${HEIGHT.toFixed(4)};
            float sway = sin(rainTime * 1.1 + position.z * 20.0 + position.y * 9.0) * 0.0006;
            vec3 local = vec3(position.x * ${RADIUS.toFixed(4)} + sway, y, position.z * ${RADIUS.toFixed(4)} + sway * 0.6);
            vec4 view = modelViewMatrix * vec4(local, 1.0);
            float edge = 1.0 - smoothstep(0.6, 1.0, length(position.xz));
            // Fading in at the top of the box and out at its foot, so none
            // appears or vanishes where the fall wraps round.
            float ends = smoothstep(0.0, 0.1, drop) * (1.0 - smoothstep(0.9, 1.0, drop));
            vFade = edge * ends * rainStrength;
            // As big as the box is widened, so a flake is as many pixels whatever
            // the eye's height.
            float widened = length(modelViewMatrix[0].xyz);
            gl_PointSize = clamp(0.00005 * widened / max(-view.z, 1e-5) * 900.0, 1.8, 5.0);
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vFade;
          void main() {
            float flake = 1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - 0.5));
            if (flake * vFade < 0.01) discard;
            gl_FragColor = vec4(vec3(0.96, 0.97, 1.0), flake * vFade * 0.9);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    this.flakes.frustumCulled = false
    this.flakes.renderOrder = 3
    this.flakes.visible = false
    this.object.add(this.streaks, this.flakes)
    this.object.visible = false
  }

  /** Whether what falls is snow rather than rain. */
  snows(snow: boolean): void {
    this.snow.value = snow ? 1 : 0
    this.streaks.visible = !snow
    this.flakes.visible = snow
  }

  /**
   * Place the shower at the eye, falling along `up`, as heavy as `strength`
   * (0 to 1). `near` is the camera's near plane: the box is widened to stand
   * well past it. Over high ground the near plane sits about a fifth of the
   * eye's height out — 0.006 at 0.03 up — and clipped the whole box away,
   * which is why snow on a frozen world was never seen: the shower falls
   * up to 0.12 high, and the box is 0.006 across.
   */
  update(eye: THREE.Vector3, strength: number, near = 0): void {
    this.strength.value = strength
    this.object.visible = strength > 0.01
    if (!this.object.visible) return
    this.object.scale.setScalar(Math.max(1, (near * 4) / RADIUS))
    this.object.position.copy(eye)
    this.up.copy(eye).normalize()
    this.quaternion.setFromUnitVectors(Rain.Y, this.up)
    this.object.quaternion.copy(this.quaternion)
  }

  dispose(): void {
    for (const drawn of [this.streaks, this.flakes]) {
      drawn.geometry.dispose()
      const material: unknown = drawn.material
      if (material instanceof THREE.Material) material.dispose()
    }
  }
}

/** How heavy the cloud is over a point, as the map was baked: kept with the winds that carry it. */
export { coverAt } from './winds'
