import * as THREE from 'three'

import type { Clock } from '@/app/clock'
import { sunDeclination, surfaceAt, type Planet } from '@/generation/planet'
import { createRng } from '@/generation/rng'
import { RING_BANDS, satellitesOf } from '@/generation/satellites'
import { starField } from '@/generation/stars'
import { logger } from '@/shared/logger'

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

import { AIR_RADIUS, buildAtmosphere, sunlightThrough } from './atmosphere'
import { HAZE_SUN, installHaze } from './haze'
import { installSteadyShadows } from './shadows'
import { BORN, birthAt, type Birth } from './birth'
import type { Builder } from './builder'
import { cloudDataOf, cloudsFromTexture, cloudsSeenFrom } from './clouds'
import { fromPalette } from './colour'
import { buildHeavens, type Heavens } from './heavens'
import { Rain } from './rain'
import { flowingCoverAt, updateFlow } from './winds'
import { Soundscape } from './sound'
import { auroraFor, auroraStrength } from './aurora'
import { VALLEY_FOG } from './valley-fog'
import { Embers, plumes, PLUME_SUN } from './volcanic'
import { spray } from './waterfalls'
import { Birds } from './birds'
import { Meteors } from './meteors'
import { DETAIL_CLOUD_MOONS, DETAIL_MOONS, moonShadow, type MoonDisc } from './eclipse'
import { volcanoesOf } from '@/generation/volcanoes'
import { cityLights } from './city-lights'
import { CITY_GLOW_WIDTH } from './work'
import { Lightning, rainShafts, SHAFT_LIGHT } from './weather'
import {
  DETAIL_AURORA,
  DETAIL_CITIES,
  DETAIL_CITY_LIGHT,
  DETAIL_CLOUD_LAYER_SUN,
  DETAIL_CLOUD_SPIN,
  DETAIL_CLOUD_SUN,
  DETAIL_CLOUDS,
  DETAIL_NORMAL_MATRIX,
  DETAIL_RANGE,
  DETAIL_RING_BANDS,
  DETAIL_RINGS,
  DETAIL_SKY,
  DETAIL_ZENITH,
  DETAIL_TIME,
  withGroundDetail,
  terrainDepthMaterial,
  withLavaDetail,
  withWaterDetail,
} from './detail'
import type { Vec3 } from './patches/cube'
import type { ViewCone } from './patches/lod'
import { Terrain } from './patches/terrain'
import { nextPixelRatio, typicalFrame, type Quality } from './quality'
import { groundTextures } from './textures'
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
  /** Draw one frame now: for the development recorder, with `manual` set. */
  readonly step: () => void
  /**
   * The view as a picture, without the page's controls: a frame drawn now
   * and read straight back, in the same task, since the drawing buffer is
   * not kept between frames.
   */
  readonly capture: () => Promise<Blob | null>
  /** The three.js scene itself, for the development recorder to inspect. */
  readonly root: THREE.Scene
  /** What the last frame drew, across every pass: for the development recorder. */
  readonly stats: () => {
    readonly calls: number
    readonly triangles: number
    readonly lines: number
    readonly points: number
    readonly geometries: number
    readonly textures: number
    readonly pixelRatio: number
  }
  /** Sound on or off (sound.ts), from inside a press; says which it is now. */
  readonly toggleSound: () => boolean
  /**
   * Stop the planet turning, for a picture: the hour stays where it is
   * until let go, and then the day carries on from there.
   */
  readonly hold: (on: boolean) => void
  /** How far the planet has turned, radians: what decides the hour everywhere on it. */
  readonly turn: () => number
  /** Turn the planet to `turn` now: a postcard's time of day. */
  readonly setTurn: (turn: number) => void
  /** The sun's direction in the room, which never moves: the planet turns under it. */
  readonly sunInRoom: () => Vec3
  /** The point under the eye, a unit direction in the planet's own frame. */
  readonly underEye: () => Vec3
  /** Where the sun is, as a direction in the planet's own frame, as it is turned now. */
  readonly sunInPlanet: () => Vec3
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
  readonly surface:
    | { readonly eye: Vec3; readonly look: Vec3; readonly up: Vec3; readonly rush: number }
    | undefined
  /** 0 is all orbit, 1 all glide. */
  readonly blend: number
}

export interface SceneOptions {
  readonly quality: Quality
  readonly builder: Builder
  /** Skip the birth animation: the planet simply appears. */
  readonly reducedMotion: boolean
  /** Where `public/` is served from, for the ground's photographs. */
  readonly assetBase: string
  /**
   * Draw only when `step` is called, never on the display's own beat: the
   * development recorder's way of rendering an exact run of frames.
   */
  readonly manual?: boolean
}

/** What belongs to one planet and goes when the next is shown. */
interface Shown {
  readonly seed: string
  readonly kind: string
  readonly world: Planet
  readonly terrain: Terrain
  readonly clouds: THREE.Mesh
  readonly air: THREE.Mesh
  readonly sky: THREE.Points
  /** Its moons and rings. */
  readonly heavens: Heavens
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

/**
 * The nearest dry, raised ground to a direction that stays land for a while
 * along the heading, so a dive lands over land and the glide does not run
 * straight back out to sea over the next coast.
 */
function landNear(planet: Planet, under: Vec3, heading: Vec3): Vec3 {
  const dry = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height > 0.04
  const solid = (d: Vec3): boolean =>
    dry(d) &&
    [0.04, 0.08, 0.12].every((k) =>
      dry(unit([d[0] + heading[0] * k, d[1] + heading[1] * k, d[2] + heading[2] * k])),
    )
  if (solid(under)) return under
  // A small island world may have no land that runs on ahead: then the
  // nearest dry ground at all, rather than the open sea.
  let nearestDry: Vec3 | undefined = dry(under) ? under : undefined
  const polar = Math.abs(under[1]) > 0.99
  const east = unit(polar ? [1, 0, 0] : [under[2], 0, -under[0]])
  const north: Vec3 = [
    under[1] * east[2] - under[2] * east[1],
    under[2] * east[0] - under[0] * east[2],
    under[0] * east[1] - under[1] * east[0],
  ]
  for (let ring = 1; ring <= 40; ring += 1) {
    const radius = ring * 0.012
    const steps = 6 + ring * 4
    for (let step = 0; step < steps; step += 1) {
      const turn = (step / steps) * Math.PI * 2
      const candidate = unit([
        under[0] + (east[0] * Math.cos(turn) + north[0] * Math.sin(turn)) * radius,
        under[1] + (east[1] * Math.cos(turn) + north[1] * Math.sin(turn)) * radius,
        under[2] + (east[2] * Math.cos(turn) + north[2] * Math.sin(turn)) * radius,
      ])
      if (solid(candidate)) return candidate
      if (nearestDry === undefined && dry(candidate)) nearestDry = candidate
    }
  }
  return nearestDry ?? under
}

/**
 * Which way to set off: the bearing with the longest run of land ahead,
 * out of sixteen, the one nearest the way the eye faced winning a tie. A
 * glide flies straight unless steered — it once leaned towards land on its
 * own, and that read as turning for no reason — so where it starts heading
 * decides whether the first minute is over ground or over open sea.
 */
function alongTheLand(planet: Planet, position: Vec3, facing: Vec3): Vec3 {
  const dry = (d: Vec3): boolean => surfaceAt(planet, d[0], d[1], d[2]).height > 0
  const along = (v: Vec3): Vec3 => {
    const k = v[0] * position[0] + v[1] * position[1] + v[2] * position[2]
    return unit([v[0] - position[0] * k, v[1] - position[1] * k, v[2] - position[2] * k])
  }
  const ahead = along(facing)
  const side: Vec3 = [
    position[1] * ahead[2] - position[2] * ahead[1],
    position[2] * ahead[0] - position[0] * ahead[2],
    position[0] * ahead[1] - position[1] * ahead[0],
  ]
  let best = ahead
  let bestRun = -1
  for (let k = 0; k < 16; k += 1) {
    // Out from straight ahead in both directions alternately, so a tie keeps
    // the bearing nearest the way the eye faced.
    const turn = (Math.ceil(k / 2) * (k % 2 === 0 ? 1 : -1) * Math.PI) / 8
    const bearing: Vec3 = [
      ahead[0] * Math.cos(turn) + side[0] * Math.sin(turn),
      ahead[1] * Math.cos(turn) + side[1] * Math.sin(turn),
      ahead[2] * Math.cos(turn) + side[2] * Math.sin(turn),
    ]
    let run = 0
    while (run < 40) {
      const t = (run + 1) * 0.006
      const step = unit([
        position[0] * Math.cos(t) + bearing[0] * Math.sin(t),
        position[1] * Math.cos(t) + bearing[1] * Math.sin(t),
        position[2] * Math.cos(t) + bearing[2] * Math.sin(t),
      ])
      if (!dry(step)) break
      run += 1
    }
    if (run > bestRun) {
      best = bearing
      bestRun = run
    }
  }
  return best
}

/** How far out the stars are laid, before they are scaled to the far plane. */
const STAR_RADIUS = 60

/** Frames measured before the governor judges the device. */
const FRAME_WINDOW = 90

/** The post pass's own frame: half float so bloom has highlights to find, multisampled so edges stay clean. */
function postTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4,
  })
}

/** A vignette and a fine grain: the two cheapest things between a render and a photograph. */
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, grain: { value: 0.035 }, vignette: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float grain;
    uniform float vignette;
    varying vec2 vUv;
    float gradeHash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float edge = 1.0 - smoothstep(0.35, 1.1, dot(d, d) * 2.4);
      c.rgb *= mix(1.0 - vignette, 1.0, edge);
      c.rgb += (gradeHash(gl_FragCoord.xy) - 0.5) * grain * c.rgb;
      gl_FragColor = c;
    }
  `,
}
/**
 * The planet turns once every two minutes seen from orbit, which is slow
 * enough to watch and fast enough to see; and once every eight in a glide,
 * which stays in daylight long enough to see the ground it came for. The
 * angle is carried forward at whichever rate the view blends to, so the
 * change of pace never jumps the ground.
 */
const ORBIT_TURN_MS = 120_000

/** Which way across the room the sun lies, in the plane of the equator: the light's old place, (5, 2.5). */
const SUN_ACROSS = new THREE.Vector2(5, 2.5).normalize()
const GLIDE_TURN_MS = 480_000

export function startScene(
  canvas: HTMLCanvasElement,
  clock: Clock,
  view: () => CameraView,
  options: SceneOptions,
): Scene {
  installHaze()
  if (!installSteadyShadows()) logger.warn('shadows.filter-unpatched')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !options.quality.post })
  // Counted over the whole frame, every pass of the composer, not only the last.
  renderer.info.autoReset = false
  let pixelRatio = options.quality.pixelRatio
  renderer.setPixelRatio(pixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = EXPOSURE
  renderer.setSize(window.innerWidth, window.innerHeight)

  const scene = new THREE.Scene()
  // The post pass: the frame rendered into a half-float target with
  // multisampling, a soft bloom off the brightest things (the sun on the
  // sea, lava, a snowfield's glints), a vignette and a grain, then tone
  // mapping and encoding once at the end. Off on a modest phone, where
  // the frame goes straight to the screen as before.
  const composer = options.quality.post ? new EffectComposer(renderer, postTarget()) : undefined
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.12,
    0.5,
    1.0,
  )
  const grade = new ShaderPass(GRADE_SHADER)
  if (composer !== undefined) {
    composer.setPixelRatio(pixelRatio)
    composer.setSize(window.innerWidth, window.innerHeight)
  }
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 100)
  if (composer !== undefined) {
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    composer.addPass(grade)
  }
  let rush = 0
  const frame = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight
    // The lens widens with the rush of a dive, which is most of what makes
    // speed felt on a screen.
    camera.fov = fieldOfView(camera.aspect) * (1 + rush * 0.16)
    camera.updateProjectionMatrix()
  }
  frame()

  // A low, warm sun from one side, so mountains throw shade and the night
  // side falls dark; the ambient is just enough to keep the night readable.
  const sun = new THREE.DirectionalLight(0xfff2e0, 3.2)
  sun.position.set(5, 1.5, 2.5)
  // The sky lights the ground from above and the ground bounces back from
  // below: what gives a snowfield's shadows their blue and keeps a slope
  // facing away from the sun from going flat. Tinted to each world's air.
  const skylight = new THREE.HemisphereLight(0x9fc3ff, 0x4a3b2c, 0.5)
  scene.add(sun, sun.target, skylight, new THREE.AmbientLight(0x22304a, 0.3))
  const sunDirection = sun.position.clone().normalize()
  // Shadows near the ground, from the trees and the relief: the shadow
  // camera is a small box kept over the ground under the eye, because a
  // map over the whole planet would give a tree a fraction of a texel.
  if (options.quality.shadowMap > 0) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    sun.castShadow = true
    sun.shadow.mapSize.set(options.quality.shadowMap, options.quality.shadowMap)
    sun.shadow.bias = -0.00002
    sun.shadow.normalBias = 0.0002
  }
  const shadowGround = new THREE.Vector3()
  let shadowReach = 0.015
  const shadowRight = new THREE.Vector3()
  const shadowUp = new THREE.Vector3()
  const modelView = new THREE.Matrix4()
  // Rain around the eye where the cloud over it is heavy, while flying low.
  const rain = new Rain()
  const lightning = new Lightning()
  const sound = new Soundscape()
  let heardStrikes = 0
  let soundFrame = 0
  let coast = 0
  const lastEye = new THREE.Vector3()
  let lastEyeAt = 0
  let speed = 0
  scene.add(rain.object)
  const embers = new Embers()
  scene.add(embers.object)
  const birds = new Birds()
  scene.add(birds.object)
  const meteors = new Meteors()
  scene.add(meteors.object)
  const meteorUp = new THREE.Vector3()
  const rainEye = new THREE.Vector3()

  const { quality, builder } = options
  let shown: Shown | undefined
  let coming: Coming | undefined

  const ground = groundTextures(options.assetBase)
  const terrainFor = (world: Planet): Terrain =>
    new Terrain(
      world,
      builder,
      {
        segments: quality.segments,
        threshold: quality.lodThreshold,
        maxLevel: quality.maxLevel,
        // The highest this planet's ground can stand: its relief, with room
        // for the fine relief on top.
        peak: world.relief * 1.1 + 0.005,
        inFlight: quality.inFlight,
        cached: quality.patchCache,
        trees: world.molten ? undefined : treeColours(world),
      },
      {
        groundDepth: terrainDepthMaterial(),
        ground: withGroundDetail(
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
          ground,
          world.molten,
        ),
        water: world.molten
          ? withLavaDetail(waterMaterial(world))
          : withWaterDetail(waterMaterial(world)),
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
          if (coming === next)
            next.clouds = cloudsFromTexture(world, texture, quality.cloudWidth, {
              segments: quality.cloudSegments,
              cirrus: quality.cirrus,
            })
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
    let heavens: Heavens
    if (keep) {
      ;({ clouds, air, sky, heavens } = previous)
    } else {
      heavens = buildHeavens(satellitesOf(next.world))
      ringsOnGround(heavens)
      // The aurora goes with the heavens: built and let go with them, and
      // like them in the room's frame, not turning with the ground.
      const aurora = auroraFor(next.world)
      if (aurora !== undefined) heavens.group.add(aurora)
      DETAIL_AURORA.value = auroraStrength(next.world) * 0.07
      clouds = next.clouds ?? cloudsFromTexture(next.world, new Uint8Array(8), 2)
      // Rain hanging from the storms, turning with the clouds they fall from.
      const held = cloudDataOf(clouds)
      if (held !== undefined && held.width > 2 && !next.world.molten)
        clouds.add(rainShafts(held.data, held.width))
      rain.snows(next.world.kind === 'frozen')
      DETAIL_CLOUDS.value = cloudMapOf(clouds)
      air = buildAtmosphere(next.world, sun.position)
      sky = buildSky(next.world, pixelRatio)
    }
    if (previous !== undefined) {
      scene.remove(previous.terrain.group)
      for (const child of previous.terrain.group.children) {
        if (child.userData.withGround === true) release(child)
      }
      previous.terrain.dispose()
      if (!keep) {
        scene.remove(previous.clouds, previous.air, previous.sky, previous.heavens.group)
        release(previous.heavens.group)
        // In a shader's uniforms, where `release` does not look.
        previous.heavens.bands?.dispose()
        release(previous.clouds)
        release(previous.air)
        release(previous.sky)
      }
    }
    scene.add(next.terrain.group)
    birds.setWorld(next.world)
    meteors.setWorld(next.world.seed)
    // Smoke from a molten world's peaks, turning with its ground.
    const smoke = plumes(next.world, volcanoesOf(next.world))
    if (smoke !== undefined) {
      smoke.userData.withGround = true
      next.terrain.group.add(smoke)
    }
    // Spray off the waterfalls: found in a worker, since they need the
    // drainage map, and added if this ground is still the one on screen.
    if (!next.world.molten) {
      const ground = next.terrain
      void options.builder.falls(next.world.seed, next.world.dials).then((placed) => {
        if (shown?.terrain !== ground) return
        const mist = spray(placed)
        if (mist === undefined) return
        mist.userData.withGround = true
        ground.group.add(mist)
      })
    }
    // The towns' lights, on a world that has towns: made in a worker, and
    // added if this ground is still the one on screen when they come.
    DETAIL_CITY_LIGHT.value = 0
    if (next.world.kind === 'temperate' || next.world.kind === 'oceanic') {
      const ground = next.terrain
      void options.builder.lights(next.world.seed, next.world.dials).then(({ lights, glow }) => {
        if (shown?.terrain !== ground) return
        const points = cityLights(lights)
        if (points === undefined) return
        points.userData.withGround = true
        ground.group.add(points)
        const map = new THREE.DataTexture(glow, CITY_GLOW_WIDTH, CITY_GLOW_WIDTH / 2)
        map.magFilter = THREE.LinearFilter
        map.minFilter = THREE.LinearFilter
        map.needsUpdate = true
        DETAIL_CITIES.value?.dispose()
        DETAIL_CITIES.value = map
        DETAIL_CITY_LIGHT.value = 0.5
      })
    }
    if (!keep) scene.add(clouds, air, sky, heavens.group)
    const animate = next.born && !options.reducedMotion
    shown = {
      seed: next.world.seed,
      kind: next.world.kind,
      world: next.world,
      terrain: next.terrain,
      clouds,
      air,
      sky,
      heavens,
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
    composer?.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)

  // The governor: watch how long frames take and, if the device is
  // struggling, render at a lower resolution. Judged over a window of frames
  // rather than reacting to one, and only ever downward.
  const frames: number[] = []
  let lastFrameAt = clock.now()
  const facing = new THREE.Vector3()

  /** Which way the camera looks, in the planet's frame, and how wide its view is to the corner. */
  const viewCone = (turn: number): ViewCone => {
    camera.getWorldDirection(facing)
    const half = THREE.MathUtils.degToRad(camera.fov / 2)
    return {
      forward: inPlanetFrame(facing, turn, 1),
      halfAngle: Math.atan(Math.tan(half) * Math.sqrt(1 + camera.aspect * camera.aspect)),
    }
  }
  let lastTurn = 0
  let turned = 0
  let turnedAt = clock.now()
  let holding = false

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
    const wanted = view.surface === undefined ? 0 : view.surface.rush * t
    if (Math.abs(wanted - rush) > 0.002) {
      rush = wanted
      frame()
    }
    // Near the ground the near plane has to come in, or the hill in front
    // of the eye is cut away; far out it can stand back, which keeps depth
    // precise across the whole planet.
    const above = camera.position.length() - 1
    if (renderer.shadowMap.enabled) {
      // Shadows only low down, where a tree is big enough to throw one:
      // from orbit the pass would cost a frame and show nothing.
      const low = t > 0 && above < 0.2
      sun.castShadow = low
      if (low) {
        // The box is stepped in size and snapped to its own texel grid, so
        // as the eye moves the shadow texels stay put on the ground. A box
        // that slid and resized every frame made each texel crawl, which
        // read as static over every flat surface — sand, ice, a cliff face.
        // With some slack before it steps back down: the eye's height rises
        // and falls with every hill it follows, and a box stepping on each
        // one changed every shadow's sharpness and reach as it went.
        const wanted = Math.min(0.09, Math.max(0.015, above * 2.5))
        if (wanted > shadowReach || wanted < shadowReach / 1.5 / 1.3) {
          shadowReach =
            0.015 * Math.pow(1.5, Math.ceil(Math.log(wanted / 0.015) / Math.log(1.5) - 1e-9))
        }
        const reach = shadowReach
        const texel = (2 * reach) / options.quality.shadowMap
        shadowGround.copy(camera.position).normalize()
        shadowRight.crossVectors(ROOM_UP, sunDirection).normalize()
        shadowUp.crossVectors(sunDirection, shadowRight)
        const a = Math.round(shadowGround.dot(shadowRight) / texel) * texel
        const b = Math.round(shadowGround.dot(shadowUp) / texel) * texel
        const c = shadowGround.dot(sunDirection)
        shadowGround
          .copy(shadowRight)
          .multiplyScalar(a)
          .addScaledVector(shadowUp, b)
          .addScaledVector(sunDirection, c)
        sun.target.position.copy(shadowGround)
        sun.position.copy(shadowGround).addScaledVector(sunDirection, 0.4)
        // Bias in proportion to the texel: a fixed one was a fraction of a
        // texel low down and too little high up, where acne speckled the
        // ground.
        sun.shadow.normalBias = texel * 1.5
        sun.shadow.bias = -texel * 0.1
        const box = sun.shadow.camera
        box.left = -reach
        box.right = reach
        box.top = reach
        box.bottom = -reach
        box.near = 0.4 - 0.08
        box.far = 0.4 + 0.08
        box.updateProjectionMatrix()
      }
    }
    // The far plane is the farthest thing that can be seen — the air shell's
    // far side, at most the eye's distance plus the shell's radius — not a
    // fixed hundred. Low down the near plane is a few thousandths, and a
    // hundred-to-one-thousandth span left a phone's depth buffer too coarse
    // to tell a tree from the ground under it or the sea from the shore, so
    // they fought and flickered. Now the span is a few hundred to one.
    const near = Math.min(0.1, Math.max(0.0004, above * 0.2))
    const far = above + 1 + AIR_RADIUS + 0.1
    if (
      Math.abs(near - camera.near) > camera.near * 0.05 ||
      Math.abs(far - camera.far) > camera.far * 0.05
    ) {
      camera.near = near
      camera.far = far
      camera.updateProjectionMatrix()
    }
    // The stars ride with the eye just inside the far plane, so they are
    // never clipped and keep their place in the sky.
    if (shown !== undefined) {
      shown.sky.position.copy(camera.position)
      shown.sky.scale.setScalar((camera.far * 0.9) / STAR_RADIUS)
    }
    airAround(above)
  }

  // The air seen from inside it: far ground fades into a haze the colour of
  // the horizon, and by day the stars go out. Both scale with height — at
  // the horizon from a low glide most of a far hill is haze, and from orbit
  // there is none.
  const fog = new THREE.FogExp2(0x000000, 0)
  scene.fog = fog
  const airColour = new THREE.Color()
  const sunTint = new THREE.Color()
  const hazeTint = new THREE.Color()
  const WHITE = new THREE.Color(1, 1, 1)
  const SUN_COLOUR = new THREE.Color(0xfff2e0)
  const SKY_LIGHT = new THREE.Color(0x9fc3ff)
  const NIGHT_LIGHT = new THREE.Color(0x1c2a44)
  const airAround = (above: number): void => {
    const low = 1 - smooth(0.08, 0.35, above)
    const elevation = camera.position.clone().normalize().dot(sunDirection)
    const day = smooth(-0.15, 0.3, elevation)
    // The sky stays lit for a while after the sun has gone — that is what
    // twilight is — and the ground under it with it. Read off the sun's own
    // day, the land went black at sunset under a sky still bright.
    const twilight = smooth(-0.2, 0.1, elevation)
    // Stars only once the sun is down and the sky is dimming.
    const starlit = 1 - smooth(-0.2, -0.03, elevation)
    // Seeing as far as the horizon, about √(2h) away, should leave a far hill
    // about half visible.
    fog.density = low * (0.65 / Math.sqrt(2 * Math.max(above, 0.002)))
    const glow: unknown = shown?.air.material
    if (glow instanceof THREE.ShaderMaterial) {
      const value: unknown = glow.uniforms.glow?.value
      if (value instanceof THREE.Color) {
        // The sky shader writes its colour straight to the screen; read as
        // sRGB here so the fog meets it at the horizon rather than a shade off.
        const k = 1.25 * twilight
        airColour.setRGB(value.r * k, value.g * k, value.b * k, THREE.SRGBColorSpace)
        // Low down, sunlight comes through a long slant of air and loses
        // the colour the air scatters (atmosphere.ts): the sun on the
        // ground, and the haze it lights, warm towards evening. From orbit
        // the sun is the sun.
        sunlightThrough(value, elevation, sunTint)
        sunTint.lerp(WHITE, 1 - low)
        sun.color.copy(SUN_COLOUR).multiply(sunTint)
        airColour.multiply(hazeTint.copy(sunTint).lerp(WHITE, 0.45))
        fog.color.copy(airColour)
        DETAIL_SKY.value.copy(airColour)
        // Overhead the air is thinner and bluer than the haze along the
        // horizon; from orbit there is no sky above the sea at all.
        DETAIL_ZENITH.value
          .setRGB(value.r * 0.55, value.g * 0.75, value.b * 1.05, THREE.SRGBColorSpace)
          .multiplyScalar(day * low)
        // The sky lights the ground from above in its own colour, the
        // ground bounces its own back, both fading with the day; the
        // ambient left is the night's.
        // Lit by the sky's own colour, not the reddened sunlight, so the
        // land under a dusk sky is blue-lit and dims with it; at night a
        // faint cool light stays, the way moonless ground is still a shape.
        skylight.color
          .setRGB(value.r, value.g, value.b, THREE.SRGBColorSpace)
          .multiplyScalar(1.6 * twilight)
          .lerp(NIGHT_LIGHT, 1 - twilight)
          .lerp(SKY_LIGHT, 1 - low)
        // And more of it at dusk, when the sun is too low to light much but
        // the sky overhead is still bright: what the land is seen by then.
        skylight.intensity = 0.18 + 0.47 * twilight + 0.6 * twilight * (1 - day)
        // The shafts of rain in the light the sky gives, with a floor for the night.
        SHAFT_LIGHT.value.copy(airColour).multiplyScalar(0.42).addScalar(0.02)
        // The dawn mist lit by the sun as it reaches the ground, and in shade by the sky.
        // Paler than the sunlight itself: mist scatters every colour, and
        // lit by the dawn sun's own deep orange it read as sand.
        VALLEY_FOG.light.value.copy(sun.color).lerp(WHITE, 0.6).multiplyScalar(0.9)
        VALLEY_FOG.shade.value
          .copy(skylight.color)
          .multiplyScalar(skylight.intensity * 0.7)
          .addScalar(0.015)
      }
    }
    // The sun in view space for the haze, weighted by how much daylight
    // reaches the air here; the camera's inverse is last frame's, which is
    // close enough for a glow.
    HAZE_SUN.value
      .copy(sunDirection)
      .transformDirection(camera.matrixWorldInverse)
      .multiplyScalar(low * day)
    const stars: unknown = shown?.sky.material
    if (stars instanceof THREE.PointsMaterial) stars.opacity = 1 - low * (1 - starlit) * 0.95
  }

  const tick = (): void => {
    renderer.info.reset()
    const now = clock.now()
    frames.push(now - lastFrameAt)
    lastFrameAt = now
    // Not while recording: frames there take whatever time they are told to.
    if (options.manual !== true && frames.length >= FRAME_WINDOW) {
      const next = nextPixelRatio(pixelRatio, typicalFrame(frames))
      frames.length = 0
      if (next !== pixelRatio) {
        pixelRatio = next
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize(window.innerWidth, window.innerHeight)
        composer?.setPixelRatio(pixelRatio)
        composer?.setSize(window.innerWidth, window.innerHeight)
      }
    }

    // Advanced by the clock, not per frame, so a dropped frame does not
    // slow the planet down.
    const seen = view()
    const turnMs = ORBIT_TURN_MS + (GLIDE_TURN_MS - ORBIT_TURN_MS) * seen.blend
    if (!holding) turned += ((now - turnedAt) / turnMs) * Math.PI * 2
    turnedAt = now
    const turn = turned
    lastTurn = turn
    // The sun stands as far north or south as the planet's season puts it
    // (planet.ts), always from the same side of the room: the planet's
    // turn under it is the time of day, its declination the time of year.
    if (shown !== undefined) {
      const declination = sunDeclination(shown.world)
      sunDirection.set(
        Math.cos(declination) * SUN_ACROSS.x,
        Math.sin(declination),
        Math.cos(declination) * SUN_ACROSS.y,
      )
      const air: unknown = shown.air.material
      if (air instanceof THREE.ShaderMaterial) {
        const value: unknown = air.uniforms.sun?.value
        if (value instanceof THREE.Vector3) value.copy(sunDirection)
      }
    }
    // Placed for the whole planet; the shadow box moves it over the eye
    // when low (`place`).
    sun.target.position.set(0, 0, 0)
    sun.position.copy(sunDirection).multiplyScalar(5)
    DETAIL_TIME.value = now / 1000
    // The winds carry the clouds (winds.ts); everything that reads them reads this.
    updateFlow(now / 1000)
    DETAIL_RANGE.value = quality.featureRange
    // The clouds drift ahead of the ground by a sixth of its turn, and their
    // shadows fall from the sun's side.
    DETAIL_CLOUD_SPIN.value = -0.15 * turn
    DETAIL_CLOUD_SUN.value.set(...inPlanetFrame(sunDirection, turn, 1))
    DETAIL_CLOUD_LAYER_SUN.value.set(...inPlanetFrame(sunDirection, turn * 1.15, 1))
    place(seen, turn)
    if (coming !== undefined) {
      coming.terrain.update(inPlanetFrame(camera.position, turn, 1), viewCone(turn))
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
      shown.heavens.update(now / 1000, sunDirection, stage.scale)
      // Where the moons are, in the ground's frame and the clouds', for the
      // shadows they throw when one passes before the sun (eclipse.ts).
      const discs: MoonDisc[] = []
      for (let k = 0; k < 2; k += 1) {
        const moon = shown.heavens.moons[k]
        const ground = DETAIL_MOONS.value[k]
        const cloud = DETAIL_CLOUD_MOONS.value[k]
        if (moon === undefined) {
          ground?.setW(0)
          cloud?.setW(0)
          continue
        }
        const at = inPlanetFrame(moon.mesh.position, turn, 1)
        ground?.set(at[0], at[1], at[2], moon.radius)
        cloud?.set(...inPlanetFrame(moon.mesh.position, turn * 1.15, 1), moon.radius)
        discs.push([at[0], at[1], at[2], moon.radius])
      }
      // Under the shadow the whole day dims, sky and all, not the ground alone.
      {
        const eye = inPlanetFrame(camera.position, turn, stage.scale)
        const reach = Math.hypot(...eye) || 1
        const under: Vec3 = [eye[0] / reach, eye[1] / reach, eye[2] / reach]
        const near = 1 - smooth(0.05, 0.4, reach - 1)
        const taken = moonShadow(under, inPlanetFrame(sunDirection, turn, 1), discs)
        renderer.toneMappingExposure = EXPOSURE * (1 - 0.7 * taken * near)
      }
      VALLEY_FOG.shape.value.z = stage.scale
      VALLEY_FOG.shape.value.w = shown.world.molten ? 0 : 1
      VALLEY_FOG.sun.value.copy(sunDirection)
      // Planet frame to view space for the ground's normal maps, from the
      // matrices as they will be this frame.
      shown.terrain.group.updateMatrixWorld()
      camera.updateMatrixWorld()
      modelView.copy(camera.matrixWorld).invert().multiply(shown.terrain.group.matrixWorld)
      DETAIL_NORMAL_MATRIX.value.getNormalMatrix(modelView)
      cloudsSeenFrom(shown.clouds, camera.position.length(), stage.scale, stage.clouds)
      shown.terrain.update(inPlanetFrame(camera.position, turn, stage.scale), viewCone(turn))
      const shower = rainOver(shown.clouds, turn)
      rain.update(rainEye.copy(camera.position), shower)
      PLUME_SUN.value.copy(sunDirection)
      // Shooting stars on the night side, seen from low enough for the sky
      // to be a sky rather than space.
      meteorUp.copy(camera.position).normalize()
      meteors.update(
        meteorUp,
        (1 - smooth(-0.15, -0.03, meteorUp.dot(sunDirection))) *
          (1 - smooth(0.04, 0.12, camera.position.length() / stage.scale - 1)),
        stage.scale,
      )
      birds.update(
        inPlanetFrame(camera.position, turn, stage.scale),
        shown.terrain.group.matrixWorld,
        stage.scale,
      )
      embers.update(
        rainEye,
        shown.world.molten
          ? 1 - smooth(0.012, 0.05, camera.position.length() / stage.scale - 1)
          : 0,
      )
      // Lightning in a storm near the eye, lighting the land a moment.
      const held = cloudDataOf(shown.clouds)
      const above = camera.position.length() / stage.scale - 1
      const flash = lightning.update(
        now / 1000,
        inPlanetFrame(camera.position, turn * 1.15, 1),
        1 - smooth(0.06, 0.14, above),
        held?.data,
        held?.width ?? 0,
      )
      skylight.intensity += flash * 2.5
      if (sound.playing) {
        // How fast the eye goes, smoothed, and how much coast is under it,
        // read every few frames: sea and land both within a short way.
        const dt = Math.max(1e-3, (now - lastEyeAt) / 1000)
        const moved = camera.position.distanceTo(lastEye) / stage.scale / dt
        speed += (Math.min(moved, 0.2) - speed) * Math.min(1, dt * 3)
        lastEye.copy(camera.position)
        lastEyeAt = now
        soundFrame += 1
        if (soundFrame % 12 === 0)
          coast = coastAround(shown.world, inPlanetFrame(camera.position, turn, 1))
        sound.update({ speed, above, coast, rain: shower }, now / 1000)
        if (lightning.strikes !== heardStrikes) {
          heardStrikes = lightning.strikes
          sound.thunder(lightning.lastAngle)
        }
      }
    }
    if (composer === undefined) renderer.render(scene, camera)
    else composer.render()
  }
  if (options.manual !== true) renderer.setAnimationLoop(tick)

  /** How heavy a shower falls on the eye: the cloud over it, only low down. */
  const rainOver = (clouds: THREE.Mesh, turn: number): number => {
    const above = camera.position.length() - 1
    if (above > 0.12) return 0
    const held = cloudDataOf(clouds)
    if (held === undefined) return 0
    // The eye's direction in the cloud layer's own frame, which turns a
    // little ahead of the ground.
    const direction = inPlanetFrame(camera.position, turn * 1.15, 1)
    const length = Math.hypot(...direction) || 1
    const cover = flowingCoverAt(
      held.data,
      held.width,
      [direction[0] / length, direction[1] / length, direction[2] / length],
      DETAIL_TIME.value,
    )
    return smooth(0.5, 0.8, cover) * (1 - smooth(0.06, 0.12, above))
  }

  return {
    show,
    diveFrom: () => {
      // Fly pressed before the first frame would read a camera still at the
      // origin and dive from nowhere: place it first.
      if (camera.position.lengthSq() < 1e-9) place(view(), lastTurn)
      const under = unit(inPlanetFrame(camera.position, lastTurn, 1))
      // The screen's up, taken into the planet's frame, is the way ahead.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const heading = inPlanetFrame(up, lastTurn, 1)
      // Dive for land: the first thing a glide shows should be ground worth
      // looking at, not a featureless sea. The nearest raised ground to the
      // point under the eye, searched in rings out to about thirty degrees;
      // the point itself if there is none that close.
      if (shown === undefined) return { position: under, heading }
      const position = landNear(shown.world, under, unit(heading))
      return { position, heading: alongTheLand(shown.world, position, unit(heading)) }
    },
    step: tick,
    root: scene,
    toggleSound: () => sound.toggle(),
    stats: () => ({
      ...renderer.info.render,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      pixelRatio: renderer.getPixelRatio(),
    }),
    sunInPlanet: () => inPlanetFrame(sunDirection, lastTurn, 1),
    hold: (on) => {
      holding = on
    },
    turn: () => turned,
    setTurn: (turn) => {
      turned = turn
      lastTurn = turn
    },
    sunInRoom: () => [sunDirection.x, sunDirection.y, sunDirection.z],
    underEye: () => {
      if (camera.position.lengthSq() < 1e-9) place(view(), lastTurn)
      return unit(inPlanetFrame(camera.position, lastTurn, 1))
    },
    capture: () =>
      new Promise((resolve) => {
        tick()
        canvas.toBlob(resolve, 'image/png')
      }),
    orbitOver: (position) => {
      const [x, y, z] = intoRoom(position, lastTurn)
      return { yaw: Math.atan2(x, z), pitch: Math.asin(Math.max(-1, Math.min(1, y))) }
    },
    dispose: () => {
      rain.dispose()
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
/** The cloud layer's own opacity texture, for the ground to take shadows from. */
function cloudMapOf(clouds: THREE.Mesh): THREE.Texture | null {
  const material: unknown = clouds.material
  if (material instanceof THREE.MeshStandardMaterial) return material.alphaMap
  return null
}

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

/** The renderer's exposure in ordinary daylight; an eclipse dims it. */
const EXPOSURE = 1.15

/** Apply a stage of the birth animation to a shown planet. */
function pose(planet: Shown, stage: Birth): void {
  planet.terrain.group.scale.setScalar(stage.scale)
  planet.clouds.scale.setScalar(stage.scale)
  planet.air.scale.setScalar(stage.scale)
  planet.heavens.group.scale.setScalar(stage.scale)
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

/**
 * The woods' colours: the world's own lush green for broadleaves, darker
 * and bluer for conifers, so the two read apart from the air.
 */
function treeColours(world: Planet): { conifer: THREE.Color; broadleaf: THREE.Color } {
  const lush = fromPalette(world.palette.lush)
  return {
    broadleaf: lush.clone().multiplyScalar(1.05),
    conifer: lush.clone().multiply(new THREE.Color(0.75, 0.9, 0.85)),
  }
}

/** How much of the ground round a point is coast, 0 to 1: sea and land both within a short way. */
function coastAround(world: Planet, eye: Vec3): number {
  const length = Math.hypot(...eye) || 1
  const u: Vec3 = [eye[0] / length, eye[1] / length, eye[2] / length]
  const side: Vec3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a: Vec3 = [
    u[1] * side[2] - u[2] * side[1],
    u[2] * side[0] - u[0] * side[2],
    u[0] * side[1] - u[1] * side[0],
  ]
  const al = Math.hypot(...a) || 1
  const e1: Vec3 = [a[0] / al, a[1] / al, a[2] / al]
  const e2: Vec3 = [
    u[1] * e1[2] - u[2] * e1[1],
    u[2] * e1[0] - u[0] * e1[2],
    u[0] * e1[1] - u[1] * e1[0],
  ]
  let sea = 0
  const samples = 9
  for (let k = 0; k < samples; k += 1) {
    const reach = k === 0 ? 0 : 0.012
    const angle = (k / (samples - 1)) * Math.PI * 2
    const x = u[0] + (e1[0] * Math.cos(angle) + e2[0] * Math.sin(angle)) * reach
    const y = u[1] + (e1[1] * Math.cos(angle) + e2[1] * Math.sin(angle)) * reach
    const z = u[2] + (e1[2] * Math.cos(angle) + e2[2] * Math.sin(angle)) * reach
    if (surfaceAt(world, x, y, z).height < 0) sea += 1
  }
  const share = sea / samples
  return Math.min(1, share * (1 - share) * 4)
}

/** Hand the rings' bands to the ground, for the shadow they cast; none, for a world without. */
function ringsOnGround(heavens: Heavens): void {
  DETAIL_RINGS.value.set(heavens.inner, heavens.outer)
  const data = heavens.bands?.image.data
  DETAIL_RING_BANDS.value.forEach((v, k) => {
    // Sixty-four of the bands' samples, four to a vector.
    const at = (i: number): number => {
      if (!(data instanceof Uint8Array)) return 0
      const sample = Math.round(((k * 4 + i) / 63) * (RING_BANDS - 1))
      return (data[sample * 4] ?? 0) / 255
    }
    v.set(at(0), at(1), at(2), at(3))
  })
}

function buildSky(world: Planet, pixelRatio: number): THREE.Points {
  const stars = starField(createRng(world.seed).fork('stars'), 2500, STAR_RADIUS)
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
