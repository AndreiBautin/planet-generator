import * as THREE from 'three'

import type { Clock } from '@/app/clock'
import type { Planet } from '@/generation/planet'
import { createRng } from '@/generation/rng'
import { starField } from '@/generation/stars'

import { buildAtmosphere } from './atmosphere'
import { buildClouds } from './clouds'
import { buildPlanetMesh } from './planet-mesh'
import { buildWater } from './water'

/**
 * The Three.js scene: a renderer filling the window, a camera, a star to
 * light the planet, and a frame loop driven by a Clock. Generation hands
 * this numbers; it never generates anything itself.
 */
export interface Scene {
  readonly dispose: () => void
}

/**
 * Where the camera should be, asked for once a frame. Defined here rather
 * than taken from the controls, so the scene does not know what moves it.
 */
export interface CameraView {
  readonly yaw: number
  readonly pitch: number
  readonly distance: number
}

export function startScene(
  canvas: HTMLCanvasElement,
  world: Planet,
  clock: Clock,
  view: () => CameraView,
): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  const pixelRatio = Math.min(window.devicePixelRatio, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setSize(window.innerWidth, window.innerHeight)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)

  // A low, warm sun from one side, so mountains throw shade and the night
  // side falls dark; the ambient is just enough to keep the night readable.
  const sun = new THREE.DirectionalLight(0xfff2e0, 3.2)
  sun.position.set(5, 1.5, 2.5)
  scene.add(sun, new THREE.AmbientLight(0x1a2438, 0.35))

  const stars = starField(createRng(world.seed).fork('stars'), 2500, 60)
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(stars.positions, 3))
  starGeometry.setAttribute('color', new THREE.BufferAttribute(stars.colours, 3))
  const sky = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      size: 1.6 * pixelRatio,
      sizeAttenuation: false,
      vertexColors: true,
      toneMapped: false,
    }),
  )
  scene.add(sky)

  // Finer on a large screen, lighter on a phone: the triangle count grows
  // with the square of the detail.
  const detail = Math.min(window.innerWidth, window.innerHeight) >= 700 ? 96 : 64
  // Land and sea turn together, as one body; the clouds drift a little
  // faster than the ground beneath them, and the air does not turn at all.
  const planet = new THREE.Group()
  planet.add(buildPlanetMesh(world, detail), buildWater(world, detail))
  const clouds = buildClouds(world, detail >= 96 ? 1024 : 512)
  scene.add(planet, clouds, buildAtmosphere(world, sun.position))

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)

  // One slow turn every two minutes, from the clock rather than per frame,
  // so a dropped frame does not slow the planet down.
  renderer.setAnimationLoop(() => {
    const { yaw, pitch, distance } = view()
    camera.position.set(
      distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(yaw),
    )
    camera.lookAt(0, 0, 0)
    const turns = clock.now() / 120_000
    planet.rotation.y = turns * Math.PI * 2
    clouds.rotation.y = turns * 1.15 * Math.PI * 2
    renderer.render(scene, camera)
  })

  return {
    dispose: () => {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      renderer.dispose()
    },
  }
}
