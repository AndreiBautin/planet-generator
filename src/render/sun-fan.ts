import * as THREE from 'three'

/** Rays in the fan. */
const RAYS = 18
/** How far the rays reach from the sun, as an angle across the sky. */
const REACH = 0.55

/**
 * Sunbeams for a phone that draws straight to the screen (quality.post off),
 * where the screen-space pass in sunbeams.ts has no finished frame to read.
 * A fan of soft rays standing in the sky round the sun, far out behind
 * everything, each its own width and brightness, swelling and fading
 * slowly — what the eye takes from crepuscular rays at a glance, for the
 * price of one draw of a few dozen triangles.
 *
 * **The depth test does the occluding**: the fan stands past the ground,
 * so a ridge in front of the sun cuts the rays off where it stands, which
 * is most of what made the real beams worth having. Clouds do not cut it;
 * the pass that reads the frame is the one that can.
 */
export class SunFan {
  readonly object: THREE.Mesh
  private readonly strength = { value: 0 }
  private readonly tint = { value: new THREE.Color(1, 0.85, 0.6) }
  private readonly time = { value: 0 }
  private readonly turn = new THREE.Quaternion()
  private static readonly Z = new THREE.Vector3(0, 0, 1)

  constructor() {
    // A disc of wedges in the xy plane, the sun at its middle, facing +z.
    const positions: number[] = []
    const rays: number[] = []
    const along: number[] = []
    const across: number[] = []
    for (let k = 0; k < RAYS; k += 1) {
      const a = (k / RAYS) * Math.PI * 2 + Math.sin(k * 12.9898) * 0.15
      const width = 0.08 + 0.1 * fract(Math.sin(k * 78.233) * 43758.5453)
      const reach = Math.tan(REACH) * (0.6 + 0.4 * fract(Math.sin(k * 39.425) * 24634.6345))
      positions.push(0, 0, 0)
      positions.push(Math.cos(a - width) * reach, Math.sin(a - width) * reach, 0)
      positions.push(Math.cos(a + width) * reach, Math.sin(a + width) * reach, 0)
      for (let v = 0; v < 3; v += 1) rays.push(k / RAYS)
      along.push(0, 1, 1)
      across.push(0, -1, 1)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('ray', new THREE.Float32BufferAttribute(rays, 1))
    geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 1))
    geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 1))
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { fanStrength: this.strength, fanTint: this.tint, fanTime: this.time },
      vertexShader: /* glsl */ `
        attribute float ray;
        attribute float along;
        attribute float across;
        varying float vRay;
        varying float vAlong;
        varying float vAcross;
        void main() {
          vRay = ray;
          vAlong = along;
          vAcross = across;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float fanStrength;
        uniform vec3 fanTint;
        uniform float fanTime;
        varying float vRay;
        varying float vAlong;
        varying float vAcross;
        void main() {
          // Each ray its own brightness, swelling and fading slowly, all
          // thinning to nothing at their ends.
          float swell = 0.45 + 0.55 * sin(fanTime * (0.12 + vRay * 0.1) + vRay * 40.0);
          float fall = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.8) * smoothstep(0.0, 0.08, vAlong);
          // Soft across a ray, or the wedges read as a flag's rising sun.
          // The across value runs -1 to 1 at the far end and is 0 at the sun, so it
          // is divided out by how far along the point is.
          float side = abs(vAcross) / max(vAlong, 1e-3);
          float soft = max(0.0, 1.0 - side * side);
          float a = fanStrength * max(0.0, swell) * fall * soft * 0.055;
          if (a < 0.002) discard;
          gl_FragColor = vec4(fanTint * a, 1.0);
        }
      `,
    })
    this.object = new THREE.Mesh(geometry, material)
    this.object.frustumCulled = false
    // After the air shell (atmosphere.ts, 10), so the rays lie over the sky.
    this.object.renderOrder = 11
    this.object.visible = false
  }

  /**
   * Stand the fan `far` out from the eye towards the sun, turned to face
   * it; `strength` from `sunbeamStrength`, `tint` the sun's colour.
   */
  update(
    eye: THREE.Vector3,
    sun: THREE.Vector3,
    far: number,
    strength: number,
    tint: THREE.Color,
    seconds: number,
  ): void {
    this.strength.value = strength
    this.object.visible = strength > 0.01
    if (!this.object.visible) return
    this.tint.value.copy(tint)
    this.time.value = seconds
    this.object.position.copy(eye).addScaledVector(sun, far)
    this.turn.setFromUnitVectors(SunFan.Z, sun)
    this.object.quaternion.copy(this.turn)
    this.object.scale.setScalar(far)
  }

  dispose(): void {
    this.object.geometry.dispose()
    const material: unknown = this.object.material
    if (material instanceof THREE.Material) material.dispose()
  }
}

const fract = (x: number): number => x - Math.floor(x)
