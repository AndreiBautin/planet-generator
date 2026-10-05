import * as THREE from 'three'

import type { Clock } from '@/app/clock'
import type { Planet } from '@/generation/planet'

import { buildPlanetMesh } from './planet-mesh'

/**
 * The Three.js scene: a renderer filling the window, a camera, a star to
 * light the planet, and a frame loop driven by a Clock. Generation hands
 * this numbers; it never generates anything itself.
 *
 */
export interface Scene {
  readonly dispose: () => void
}

export function startScene(host: HTMLElement, world: Planet, clock: Clock): Scene {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  host.prepend(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)
  camera.position.set(0, 0, 3.2)

  const sun = new THREE.DirectionalLight(0xffffff, 2.4)
  sun.position.set(4, 2, 3)
  scene.add(sun, new THREE.AmbientLight(0x223044, 0.6))

  // Finer on a large screen, lighter on a phone: the triangle count grows
  // with the square of the detail.
  const detail = Math.min(window.innerWidth, window.innerHeight) >= 700 ? 96 : 64
  const planet = buildPlanetMesh(world, detail)
  scene.add(planet)

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)

  // One slow turn every two minutes, from the clock rather than per frame,
  // so a dropped frame does not slow the planet down.
  renderer.setAnimationLoop(() => {
    planet.rotation.y = (clock.now() / 120_000) * Math.PI * 2
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
