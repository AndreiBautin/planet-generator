import * as THREE from 'three'

import type { Clock } from '@/app/clock'

/**
 * The Three.js scene: a renderer filling the window, a camera, a star to
 * light the planet, and a frame loop driven by a Clock. Generation hands
 * this numbers; it never generates anything itself.
 *
 * This is the foundations' placeholder — one sphere in the seed's colour —
 * proving the bundle, the canvas and the seed reach the screen. The
 * planet replaces the sphere.
 */
export interface Scene {
  readonly dispose: () => void
}

export function startScene(host: HTMLElement, colour: number, clock: Clock): Scene {
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

  const planet = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 32),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }),
  )
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
