import * as THREE from 'three'

import { MOON_MAP_WIDTH, RING_BANDS, type Satellites } from '@/generation/satellites'

/**
 * A planet's moons and rings, drawn (generation/satellites.ts decides them).
 *
 * In the room's frame, not the planet's: the planet turns under its rings
 * — they lie in its equator, so a turn about its axis leaves them where
 * they are — and the moons keep their own time. Scaled with the planet as
 * it is born, so they arrive with it.
 *
 * The moons are lit like everything else, so their phases are simply the
 * sun on a sphere: full opposite the sun, new beside it. The rings are a
 * flat annulus, banded and see-through, dark where the planet's shadow
 * falls across them; the shadow they cast on the ground is the ground
 * shader's (detail.ts), from the same bands.
 */
export interface Heavens {
  readonly group: THREE.Group
  /** The bands as a texture, for the ground to read the rings' shadow from; absent with no rings. */
  readonly bands: THREE.DataTexture | undefined
  readonly inner: number
  readonly outer: number
  /** Move the moons to where they are at `seconds`, and tell the rings where the sun is. */
  readonly update: (seconds: number, sun: THREE.Vector3, scale: number) => void
}

export function buildHeavens(sky: Satellites): Heavens {
  const group = new THREE.Group()
  const moons = sky.moons.map((moon) => {
    const width = MOON_MAP_WIDTH
    const height = width / 2
    const pixels = new Uint8Array(width * height * 4)
    for (let k = 0; k < width * height; k += 1) {
      const v = moon.surface[k] ?? 0.5
      pixels[k * 4] = Math.round(255 * Math.min(1, v * moon.tint[0] * 1.4))
      pixels[k * 4 + 1] = Math.round(255 * Math.min(1, v * moon.tint[1] * 1.4))
      pixels[k * 4 + 2] = Math.round(255 * Math.min(1, v * moon.tint[2] * 1.4))
      pixels[k * 4 + 3] = 255
    }
    // Rows south to north, as a sphere's map runs (v = 1 at the north pole).
    const flipped = new Uint8Array(pixels.length)
    for (let y = 0; y < height; y += 1) {
      flipped.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4)
    }
    const map = new THREE.DataTexture(flipped, width, height)
    map.colorSpace = THREE.SRGBColorSpace
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearFilter
    map.wrapS = THREE.RepeatWrapping
    map.needsUpdate = true
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(moon.radius, 48, 24),
      // Not fogged: it is beyond the air, and the sky drawn over it is the haze.
      new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0, fog: false }),
    )
    group.add(mesh)
    return { moon, mesh }
  })

  let bands: THREE.DataTexture | undefined
  const rings = sky.rings
  let ringMaterial: THREE.ShaderMaterial | undefined
  if (rings !== undefined) {
    const data = new Uint8Array(RING_BANDS * 4)
    for (let i = 0; i < RING_BANDS; i += 1) {
      const v = Math.round(255 * (rings.bands[i] ?? 0))
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    bands = new THREE.DataTexture(data, RING_BANDS, 1)
    bands.magFilter = THREE.LinearFilter
    bands.minFilter = THREE.LinearFilter
    bands.needsUpdate = true
    ringMaterial = new THREE.ShaderMaterial({
      uniforms: {
        bands: { value: bands },
        tint: { value: new THREE.Color(...rings.tint) },
        sun: { value: new THREE.Vector3(1, 0, 0) },
        planet: { value: 1 },
        inner: { value: rings.inner },
        outer: { value: rings.outer },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        varying vec3 vWorld;
        void main() {
          vLocal = position;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D bands;
        uniform vec3 tint;
        uniform vec3 sun;
        uniform float planet;
        uniform float inner;
        uniform float outer;
        varying vec3 vLocal;
        varying vec3 vWorld;
        void main() {
          float r = length(vLocal.xy);
          float t = (r - inner) / (outer - inner);
          if (t < 0.0 || t > 1.0) discard;
          float solid = texture2D(bands, vec2(t, 0.5)).r;
          if (solid < 0.01) discard;
          // In the planet's shadow: the line from here to the sun passes
          // through the planet. Soft at the edge, as the sun is not a point.
          float along = dot(vWorld, sun);
          float miss = length(vWorld - sun * along);
          float shade = along > 0.0 ? 1.0 : smoothstep(planet * 0.96, planet * 1.04, miss);
          // Grains of ice and dust scatter forward most: brighter seen
          // against the sun, but lit from either face.
          vec3 eye = normalize(cameraPosition - vWorld);
          float forward = pow(max(dot(-eye, sun), 0.0), 6.0);
          vec3 colour = tint * (0.08 + 1.1 * shade * (0.75 + forward * 0.8));
          gl_FragColor = vec4(colour, solid * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(rings.inner, rings.outer, 256, 1),
      ringMaterial,
    )
    // RingGeometry lies in its XY plane; the planet's equator is the room's XZ.
    ring.rotation.x = -Math.PI / 2
    // After the ground and the clouds, before the air, which is the haze over all of it.
    ring.renderOrder = 5
    group.add(ring)
  }

  const axis = new THREE.Vector3()
  const where = new THREE.Vector3()
  return {
    group,
    bands,
    inner: rings?.inner ?? 0,
    outer: rings?.outer ?? 0,
    update: (seconds, sun, scale) => {
      for (const { moon, mesh } of moons) {
        const angle = moon.phase + (seconds / moon.period) * Math.PI * 2
        where.set(Math.cos(angle) * moon.distance, 0, Math.sin(angle) * moon.distance)
        // Its orbit tilted about the line where it crosses the equator.
        axis.set(Math.cos(moon.node), 0, Math.sin(moon.node))
        where.applyAxisAngle(axis, moon.inclination)
        mesh.position.copy(where)
        // Tidally locked: the same face always turned to the planet.
        mesh.rotation.y = -angle
      }
      if (ringMaterial !== undefined) {
        const { sun: towards, planet } = ringMaterial.uniforms
        if (towards !== undefined) (towards.value as THREE.Vector3).copy(sun)
        if (planet !== undefined) planet.value = scale
      }
    },
  }
}
