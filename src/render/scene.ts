import * as THREE from 'three'

import type { Clock } from '@/app/clock'
import type { Planet } from '@/generation/planet'
import { createRng } from '@/generation/rng'
import { starField } from '@/generation/stars'

import { AIR_RADIUS, buildAtmosphere } from './atmosphere'
import { BORN, birthAt, type Birth } from './birth'
import type { Builder } from './builder'
import { cloudsFromTexture, cloudsSeenFrom } from './clouds'
import type { Vec3 } from './patches/cube'
import { Terrain } from './patches/terrain'
import { nextPixelRatio, typicalFrame, type Quality } from './quality'
import { waterMaterial } from './water'

/**
 * The Three.js scene: a renderer filling the window, a camera, a star to
 * light the planet, and a frame loop driven by a Clock. Generation hands
 * this numbers; it never generates anything itself.
 *
 * The renderer, camera and sun live for the page. A planet is shown by
 * starting its terrain streaming behind the one on screen, and swapping the
 * two once the new one has its six faces and its clouds — so New planet
 * never shows an empty sky, and a dial moved keeps the old ground until the
 * new ground is there to replace it.
 */
export interface Scene {
  /** Resolves true once the planet is on screen, false if another was asked for first. */
  readonly show: (planet: Planet, options: { readonly born: boolean }) => Promise<boolean>
  /**
   * Where to begin a glide from here: the ground under the middle of the
   * view, heading towards the top of the screen — so the dive goes into
   * the picture the person was looking at.
   */
  readonly diveFrom: () => { readonly position: Vec3; readonly heading: Vec3 }
  /** The orbit angles that look straight down on a point of the planet, as it is turned now. */
  readonly orbitOver: (position: Vec3) => { readonly yaw: number; readonly pitch: number }
  readonly dispose: () => void
}

/**
 * Where the camera should be, asked for once a frame. Defined here rather
 * than taken from the controls, so the scene does not know what moves it.
 *
 * Two cameras and a blend between them: the orbit, in the room's frame,
 * and the glide, in the planet's own frame so it is carried round as the
 * planet turns. Blending in the scene is what lets a dive start from
 * wherever the orbit was and land wherever the glide is.
 */
export interface CameraView {
  readonly orbit: {
    readonly yaw: number
    readonly pitch: number
    readonly distance: number
  }
  readonly surface: { readonly eye: Vec3; readonly look: Vec3; readonly up: Vec3 } | undefined
  /** 0 is all orbit, 1 all glide. */
  readonly blend: number
}

export interface SceneOptions {
  readonly quality: Quality
  readonly builder: Builder
  /** Skip the birth animation: the planet simply appears. */
  readonly reducedMotion: boolean
}

/** What belongs to one planet and goes when the next is shown. */
interface Shown {
  readonly seed: string
  readonly kind: string
  readonly terrain: Terrain
  readonly clouds: THREE.Mesh
  readonly air: THREE.Mesh
  readonly sky: THREE.Points
  /** Clock time the planet appeared, for the birth animation; absent if it simply appeared. */
  readonly bornAt: number | undefined
}

/** A planet being made behind the one on screen. */
interface Coming {
  readonly world: Planet
  readonly terrain: Terrain
  /** The clouds, once baked; absent while baking, or when the shown ones will do. */
  clouds: THREE.Mesh | undefined
  readonly keepClouds: boolean
  readonly born: boolean
  readonly resolve: (shown: boolean) => void
}

/** Frames measured before the governor judges the device. */
const FRAME_WINDOW = 90
/** One slow turn every two minutes. */
const TURN_MS = 120_000

export function startScene(
  canvas: HTMLCanvasElement,
  clock: Clock,
  view: () => CameraView,
  options: SceneOptions,
): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  let pixelRatio = options.quality.pixelRatio
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

  const { quality, builder } = options
  let shown: Shown | undefined
  let coming: Coming | undefined

  const terrainFor = (world: Planet): Terrain =>
    new Terrain(
      world,
      builder,
      {
        segments: quality.segments,
        threshold: quality.lodThreshold,
        maxLevel: quality.maxLevel,
        inFlight: 8,
        cached: 320,
      },
      {
        ground: new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.92,
          metalness: 0,
        }),
        water: waterMaterial(world),
      },
    )

  const show = (world: Planet, { born }: { readonly born: boolean }): Promise<boolean> => {
    // The sky, the clouds and the air depend on the seed and the kind, not
    // on the dials, so moving a dial rebuilds only the ground and the sea —
    // the clouds are the slowest thing here to bake.
    const keepClouds = shown !== undefined && shown.seed === world.seed && shown.kind === world.kind
    if (coming !== undefined) {
      coming.terrain.dispose()
      if (coming.clouds !== undefined) release(coming.clouds)
      coming.resolve(false)
    }
    return new Promise((resolve) => {
      const next: Coming = {
        world,
        terrain: terrainFor(world),
        clouds: undefined,
        keepClouds,
        born,
        resolve,
      }
      coming = next
      if (!keepClouds) {
        void builder.clouds(world.seed, world.dials, quality.cloudWidth).then((texture) => {
          if (coming === next) next.clouds = cloudsFromTexture(world, texture, quality.cloudWidth)
        })
      }
    })
  }

  /** Put a made planet on screen, and let go of the one it replaces. */
  const arrive = (next: Coming): void => {
    const previous = shown
    const keep = next.keepClouds && previous !== undefined
    let clouds: THREE.Mesh
    let air: THREE.Mesh
    let sky: THREE.Points
    if (keep) {
      ;({ clouds, air, sky } = previous)
    } else {
      clouds = next.clouds ?? cloudsFromTexture(next.world, new Uint8Array(8), 2)
      air = buildAtmosphere(next.world, sun.position)
      sky = buildSky(next.world, pixelRatio)
    }
    if (previous !== undefined) {
      scene.remove(previous.terrain.group)
      previous.terrain.dispose()
      if (!keep) {
        scene.remove(previous.clouds, previous.air, previous.sky)
        release(previous.clouds)
        release(previous.air)
        release(previous.sky)
      }
    }
    scene.add(next.terrain.group)
    if (!keep) scene.add(clouds, air, sky)
    const animate = next.born && !options.reducedMotion
    shown = {
      seed: next.world.seed,
      kind: next.world.kind,
      terrain: next.terrain,
      clouds,
      air,
      sky,
      bornAt: animate ? clock.now() : keep ? previous.bornAt : undefined,
    }
    pose(shown, animate ? birthAt(0) : stageOf(shown))
    next.resolve(true)
  }

  const stageOf = (planet: Shown): Birth =>
    planet.bornAt === undefined ? BORN : birthAt((clock.now() - planet.bornAt) / 1000)

  const resize = (): void => {
    frame()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)

  // The governor: watch how long frames take and, if the device is
  // struggling, render at a lower resolution. Judged over a window of frames
  // rather than reacting to one, and only ever downward.
  const frames: number[] = []
  let lastFrameAt = clock.now()
  let lastTurn = 0

  const orbitEye = new THREE.Vector3()
  const surfaceEye = new THREE.Vector3()
  const surfaceLook = new THREE.Vector3()
  const surfaceUp = new THREE.Vector3()
  const target = new THREE.Vector3()
  const up = new THREE.Vector3()
  const ROOM_UP = new THREE.Vector3(0, 1, 0)
  const ORIGIN = new THREE.Vector3(0, 0, 0)

  /** Put the camera where the view asks, blending the orbit and the glide. */
  const place = (view: CameraView, turn: number): void => {
    const { yaw, pitch, distance } = view.orbit
    orbitEye.set(
      distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(yaw),
    )
    const t = view.surface === undefined ? 0 : Math.min(1, Math.max(0, view.blend))
    if (view.surface === undefined || t === 0) {
      camera.position.copy(orbitEye)
      camera.up.copy(ROOM_UP)
      camera.lookAt(ORIGIN)
    } else {
      surfaceEye.set(...intoRoom(view.surface.eye, turn))
      surfaceLook.set(...intoRoom(view.surface.look, turn))
      surfaceUp.set(...intoRoom(view.surface.up, turn))
      camera.position.lerpVectors(orbitEye, surfaceEye, t)
      target.lerpVectors(ORIGIN, surfaceLook, t)
      up.lerpVectors(ROOM_UP, surfaceUp, t).normalize()
      camera.up.copy(up)
      camera.lookAt(target)
    }
    // Near the ground the near plane has to come in, or the hill in front
    // of the eye is cut away; far out it can stand back, which keeps depth
    // precise across the whole planet.
    const above = camera.position.length() - 1
    const near = Math.min(0.1, Math.max(0.0004, above * 0.2))
    if (Math.abs(near - camera.near) > camera.near * 0.05) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
    airAround(above)
  }

  // The air seen from inside it: far ground fades into a haze the colour of
  // the horizon, and by day the stars go out. Both scale with height — at
  // the horizon from a low glide most of a far hill is haze, and from orbit
  // there is none.
  const fog = new THREE.FogExp2(0x000000, 0)
  scene.fog = fog
  const sunDirection = sun.position.clone().normalize()
  const airColour = new THREE.Color()
  const airAround = (above: number): void => {
    const low = 1 - smooth(0.08, 0.35, above)
    const day = smooth(-0.15, 0.3, camera.position.clone().normalize().dot(sunDirection))
    // Seeing as far as the horizon, about √(2h) away, should leave a far hill
    // about half visible.
    fog.density = low * (0.85 / Math.sqrt(2 * Math.max(above, 0.002)))
    const glow: unknown = shown?.air.material
    if (glow instanceof THREE.ShaderMaterial) {
      const value: unknown = glow.uniforms.glow?.value
      if (value instanceof THREE.Color) {
        // The sky shader writes its colour straight to the screen; read as
        // sRGB here so the fog meets it at the horizon rather than a shade off.
        const k = 1.25 * day
        airColour.setRGB(value.r * k, value.g * k, value.b * k, THREE.SRGBColorSpace)
        fog.color.copy(airColour)
      }
    }
    const stars: unknown = shown?.sky.material
    if (stars instanceof THREE.PointsMaterial) stars.opacity = 1 - low * day * 0.92
  }

  renderer.setAnimationLoop(() => {
    const now = clock.now()
    frames.push(now - lastFrameAt)
    lastFrameAt = now
    if (frames.length >= FRAME_WINDOW) {
      const next = nextPixelRatio(pixelRatio, typicalFrame(frames))
      frames.length = 0
      if (next !== pixelRatio) {
        pixelRatio = next
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize(window.innerWidth, window.innerHeight)
      }
    }

    // From the clock rather than per frame, so a dropped frame does not
    // slow the planet down.
    const turn = (now / TURN_MS) * Math.PI * 2
    lastTurn = turn
    place(view(), turn)
    if (coming !== undefined) {
      coming.terrain.update(inPlanetFrame(camera.position, turn, 1))
      if (coming.terrain.ready && (coming.keepClouds || coming.clouds !== undefined)) {
        const next = coming
        coming = undefined
        arrive(next)
      }
    }
    if (shown !== undefined) {
      const stage = stageOf(shown)
      shown.terrain.group.rotation.y = turn
      shown.clouds.rotation.y = turn * 1.15
      pose(shown, stage)
      cloudsSeenFrom(shown.clouds, camera.position.length(), stage.scale, stage.clouds)
      shown.terrain.update(inPlanetFrame(camera.position, turn, stage.scale))
    }
    renderer.render(scene, camera)
  })

  return {
    show,
    diveFrom: () => {
      const position = unit(inPlanetFrame(camera.position, lastTurn, 1))
      // The screen's up, taken into the planet's frame, is the way ahead.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const heading = inPlanetFrame(up, lastTurn, 1)
      return { position, heading }
    },
    orbitOver: (position) => {
      const [x, y, z] = intoRoom(position, lastTurn)
      return { yaw: Math.atan2(x, z), pitch: Math.asin(Math.max(-1, Math.min(1, y))) }
    },
    dispose: () => {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      coming?.terrain.dispose()
      if (shown !== undefined) {
        shown.terrain.dispose()
        release(shown.clouds)
        release(shown.air)
        release(shown.sky)
      }
      renderer.dispose()
    },
  }
}

/** 0 below `from`, 1 above `to`, eased between. */
function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** A point in the planet's own frame, carried round to where the planet has turned to. */
function intoRoom(point: Vec3, turn: number): [number, number, number] {
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  return [point[0] * cos + point[2] * sin, point[1], -point[0] * sin + point[2] * cos]
}

/**
 * The camera in the planet's own frame: undo the planet's turn about its
 * axis and its birth scale, so the terrain is split for where the camera is
 * relative to the ground rather than relative to the room.
 */
function inPlanetFrame(
  position: { readonly x: number; readonly y: number; readonly z: number },
  turn: number,
  scale: number,
): Vec3 {
  const cos = Math.cos(-turn)
  const sin = Math.sin(-turn)
  const x = position.x * cos + position.z * sin
  const z = -position.x * sin + position.z * cos
  const s = scale > 0 ? 1 / scale : 1
  return [x * s, position.y * s, z * s]
}

/** Apply a stage of the birth animation to a shown planet. */
function pose(planet: Shown, stage: Birth): void {
  planet.terrain.group.scale.setScalar(stage.scale)
  planet.clouds.scale.setScalar(stage.scale)
  planet.air.scale.setScalar(stage.scale)
  const air: unknown = planet.air.material
  if (air instanceof THREE.ShaderMaterial) {
    const { strength, outer, inner } = air.uniforms
    if (strength !== undefined) strength.value = stage.air
    if (outer !== undefined) outer.value = AIR_RADIUS * stage.scale
    if (inner !== undefined) inner.value = stage.scale
  }
}

/** The narrower of the two angles the view spans, in degrees. */
const FIELD_OF_VIEW = 45

/**
 * The vertical field of view that keeps the narrower side at 45 degrees.
 * Three's fov is vertical, so a phone held upright kept 45 degrees top to
 * bottom and barely half that across: the planet ran off both sides.
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
      // Stars are far beyond the air and must not take the haze's colour.
      fog: false,
      transparent: true,
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
