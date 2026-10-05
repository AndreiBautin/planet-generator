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
 *
 * The renderer, camera and sun live for the page; a planet is shown, and
 * replaced by the next one shown, with everything the old one allocated on
 * the GPU released.
 */
export interface Scene {
  readonly show: (planet: Planet) => void
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

/** What belongs to one planet and goes when the next is shown. */
interface Shown {
  readonly seed: string
  readonly kind: string
  readonly body: THREE.Group
  readonly clouds: THREE.Mesh
  readonly air: THREE.Mesh
  readonly sky: THREE.Points
}

export function startScene(canvas: HTMLCanvasElement, clock: Clock, view: () => CameraView): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  const pixelRatio = Math.min(window.devicePixelRatio, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setSize(window.innerWidth, window.innerHeight)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 100)
  const frame = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.fov = fieldOfView(camera.aspect)
    camera.updateProjectionMatrix()
  }
  frame()

  // A low, warm sun from one side, so mountains throw shade and the night
  // side falls dark; the ambient is just enough to keep the night readable.
  const sun = new THREE.DirectionalLight(0xfff2e0, 3.2)
  sun.position.set(5, 1.5, 2.5)
  scene.add(sun, new THREE.AmbientLight(0x1a2438, 0.35))

  // Finer on a large screen, lighter on a phone: the triangle count grows
  // with the square of the detail.
  const detail = Math.min(window.innerWidth, window.innerHeight) >= 700 ? 96 : 64
  let shown: Shown | undefined

  const show = (world: Planet): void => {
    // The sky, the clouds and the air depend on the seed and the kind, not
    // on the dials, so moving a dial rebuilds only the ground and the sea —
    // the clouds are the slowest thing here to bake.
    const same = shown !== undefined && shown.seed === world.seed && shown.kind === world.kind
    const previous = shown

    // Land and sea turn together, as one body; the clouds drift a little
    // faster than the ground beneath them, and the air does not turn at all.
    const body = new THREE.Group()
    body.add(buildPlanetMesh(world, detail), buildWater(world, detail))
    const clouds =
      same && previous !== undefined
        ? previous.clouds
        : buildClouds(world, detail >= 96 ? 1024 : 512)
    const air = same && previous !== undefined ? previous.air : buildAtmosphere(world, sun.position)
    const sky = same && previous !== undefined ? previous.sky : buildSky(world, pixelRatio)

    if (previous !== undefined) {
      scene.remove(previous.body)
      release(previous.body)
      if (!same) {
        scene.remove(previous.clouds, previous.air, previous.sky)
        release(previous.clouds)
        release(previous.air)
        release(previous.sky)
      }
    }
    scene.add(body)
    if (!same) scene.add(clouds, air, sky)
    shown = { seed: world.seed, kind: world.kind, body, clouds, air, sky }
  }

  const resize = (): void => {
    frame()
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
    if (shown !== undefined) {
      const turns = clock.now() / 120_000
      shown.body.rotation.y = turns * Math.PI * 2
      shown.clouds.rotation.y = turns * 1.15 * Math.PI * 2
    }
    renderer.render(scene, camera)
  })

  return {
    show,
    dispose: () => {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      if (shown !== undefined) {
        release(shown.body)
        release(shown.clouds)
        release(shown.air)
        release(shown.sky)
      }
      renderer.dispose()
    },
  }
}

/** The narrower of the two angles the view spans, in degrees. */
const FIELD_OF_VIEW = 45

/**
 * The vertical field of view that keeps the narrower side at 45�. Three's
 * fov is vertical, so a phone held upright kept 45� top to bottom and had
 * barely half that across: the planet ran off both sides of the screen.
 */
function fieldOfView(aspect: number): number {
  if (aspect >= 1) return FIELD_OF_VIEW
  const half = THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2)
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / aspect))
}

function buildSky(world: Planet, pixelRatio: number): THREE.Points {
  const stars = starField(createRng(world.seed).fork('stars'), 2500, 60)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(stars.positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(stars.colours, 3))
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 1.2 * pixelRatio,
      sizeAttenuation: false,
      vertexColors: true,
      toneMapped: false,
    }),
  )
}

/**
 * Free what an object put on the GPU. Three does not collect geometry,
 * materials or textures when an object leaves the scene, so a "new planet"
 * button pressed fifty times would otherwise hold fifty planets.
 */
function release(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Points)) return
    // Read as unknown and narrowed: Three types these loosely enough that
    // the compiler would otherwise take them on trust.
    const geometry: unknown = node.geometry
    if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
    const materials: unknown = node.material
    for (const material of Array.isArray(materials) ? materials : [materials]) {
      if (!(material instanceof THREE.Material)) continue
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}
