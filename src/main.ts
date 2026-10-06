import type { Vec3 } from '@/generation/cube'
import { fixedClock, systemClock } from '@/app/clock'
import { readConfig } from '@/app/config'
import { linkFor, parseLink } from '@/app/link'
import { createPlanet, DEFAULT_DIALS, type Dials, type Planet } from '@/generation/planet'
import { newSeed, type Seed } from '@/generation/seed'
import { createBuilder } from '@/render/builder'
import { groundRadiusAt } from '@/render/patches/patch-data'
import { pickQuality } from '@/render/quality'
import { startScene } from '@/render/scene'
import { logger, setLogLevel } from '@/shared/logger'
import { attachGestures } from '@/ui/controls'
import { attachHud } from '@/ui/hud'
import { TERRAIN_STATS } from '@/render/patches/terrain'
import { createRig } from '@/ui/rig'
import { savePicture, shareLink } from '@/ui/share'

/**
 * The composition root: read config, settle the seed, start the scene and
 * wire the controls. The only file that names concrete implementations
 * (the system clock, the browser's entropy source, the worker) and the only
 * one that owns the state — which planet, at which dials.
 */
const { config, warnings } = readConfig()
const buildLabel = document.getElementById('build')
if (buildLabel !== null) buildLabel.textContent = `build ${config.build}`
setLogLevel(config.logLevel)
for (const warning of warnings) logger.warn('config.invalid', { warning })

const freshSeed = (): Seed =>
  newSeed((bytes) => {
    crypto.getRandomValues(bytes)
  })

// The link is the state: the seed and dials live in the URL, so the address
// bar is the share button and Back returns to the planet before.
const opened = parseLink(window.location.search)
let seed: Seed = opened.seed ?? freshSeed()
let dials: Dials = opened.dials

const quality = pickQuality({
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: window.devicePixelRatio,
  cores: navigator.hardwareConcurrency,
})
logger.info('quality.picked', { ...quality })

// The canvas is made here so the controls and the scene can share it
// without either knowing about the other: render/ never imports ui/.
const canvas = document.createElement('canvas')
canvas.setAttribute('aria-label', 'The planet. Drag to turn it, pinch or scroll to zoom.')
canvas.setAttribute('role', 'img')
document.body.prepend(canvas)

// The ground a glide flies over is the planet on screen: read through a
// variable, because a dial moved mid-flight swaps the planet under it.
let planet: Planet = createPlanet(seed, dials)
// Development only: `?record` drives time and frames by hand, so a run of
// frames can be rendered exactly and compared — the only way to see flicker
// in a preview that draws nothing on its own.
const recording = config.developer && new URLSearchParams(window.location.search).has('record')
// `?record=120000` starts the clock that far in, for a different time of day.
const recordStart = Number(new URLSearchParams(window.location.search).get('record'))
const recordClock = fixedClock(Number.isFinite(recordStart) && recordStart > 0 ? recordStart : 1000)
const clock = recording ? recordClock : systemClock
const rig = createRig(clock, () => (direction) => groundRadiusAt(planet, direction))
attachGestures(canvas, clock, rig.gestures)
const scene = startScene(canvas, clock, rig.view, {
  manual: recording,
  quality,
  builder: createBuilder(navigator.hardwareConcurrency),
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  assetBase: config.assetBase,
})

/**
 * Show the current seed and dials. A new world is born; a dial moved on the
 * same world just changes, because a planet swelling from nothing every time
 * the sea rises a notch would be a show nobody asked for.
 */
const show = async (born: boolean): Promise<void> => {
  const next = createPlanet(seed, dials)
  planet = next
  hud.render(next)
  document.body.classList.add('forming')
  // False when a later planet was asked for first; that one will clear the
  // forming state when it arrives.
  if (!(await scene.show(next, { born }))) return
  document.body.classList.remove('forming')
  logger.info('planet.shown', { seed, kind: next.kind })
}

const hud = attachHud({
  onNew: () => {
    // A new world is born in orbit: rising over the old one first would be
    // two seconds of a planet that is about to be replaced.
    rig.cut()
    hud.flying(false)
    seed = freshSeed()
    dials = DEFAULT_DIALS
    window.history.pushState(null, '', linkFor(seed, dials))
    void show(true)
  },
  onShare: () => {
    void shareLink(document.title, window.location.href).then((message) => {
      if (message !== undefined) hud.toast(message)
    })
  },
  onFly: () => {
    if (rig.flying()) rig.land(scene.orbitOver)
    else rig.fly(scene.diveFrom())
    hud.flying(rig.flying())
  },
  onTour: () => {
    if (rig.touring()) {
      rig.tour(false)
      return
    }
    if (!rig.flying()) {
      rig.fly(scene.diveFrom())
      hud.flying(true)
    }
    rig.tour(true)
  },
  onPhoto: () => {
    takePicture()
  },
  onSound: () => {
    hud.sounding(scene.toggleSound())
  },
  onDials: (next) => {
    dials = next
    // Replaced rather than pushed: a dial dragged across its range is one
    // decision, not forty steps for Back to walk through.
    window.history.replaceState(null, '', linkFor(seed, dials))
    void show(false)
  },
})

rig.onTour((touring) => {
  hud.touring(touring)
})

const flash = document.getElementById('flash')
function takePicture(): void {
  // The shutter's blink restarts on every press.
  flash?.classList.remove('shot')
  flash?.getBoundingClientRect()
  flash?.classList.add('shot')
  const name = `${planet.name} ${planet.seed}`.replace(/[^\w -]+/g, '').trim()
  void scene
    .capture()
    .then(async (blob) => (blob === null ? 'Could not take a picture' : savePicture(blob, name)))
    .then((message) => {
      if (message !== undefined) hud.toast(message)
    })
}

// Arrow keys steer a glide on a keyboard, and Escape lands. P takes a
// picture whether flying or not.
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return
  if (event.key === 'p' || event.key === 'P') {
    takePicture()
    return
  }
  if (!rig.flying()) return
  const steps: Record<string, readonly [number, number]> = {
    ArrowLeft: [-0.04, 0],
    ArrowRight: [0.04, 0],
    ArrowUp: [0, -0.06],
    ArrowDown: [0, 0.06],
    a: [-0.04, 0],
    d: [0.04, 0],
    w: [0, -0.06],
    s: [0, 0.06],
  }
  const step = steps[event.key]
  if (step !== undefined) {
    event.preventDefault()
    rig.nudge(step[0], step[1])
  } else if (event.key === 'Escape') {
    rig.land(scene.orbitOver)
    hud.flying(false)
  }
})

window.addEventListener('popstate', () => {
  rig.cut()
  hud.flying(false)
  const link = parseLink(window.location.search)
  const changed = link.seed !== seed
  seed = link.seed ?? freshSeed()
  dials = link.dials
  void show(changed)
})

window.history.replaceState(null, '', linkFor(seed, dials))
void show(true)

// Installed and offline: the worker caches the app on first visit. Resolved
// against the page, so it registers under whatever path the app is served
// from (the root locally, /planet-generator/ on Pages).
if (config.serviceWorker && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {
    logger.warn('service-worker.failed')
  })
}

if (recording) {
  Object.assign(window, {
    recorder: {
      /** Move time on by `ms` and draw one frame. */
      step: (ms: number) => {
        recordClock.advance(ms)
        scene.step()
      },
      /** Turn and climb as the keyboard does. */
      nudge: (turn: number, climb: number) => {
        rig.nudge(turn, climb)
      },
      /** The three.js scene, to inspect what is drawn. */
      root: scene.root,
      sun: () => scene.sunInPlanet(),
      /** The terrain's last selection: stand-ins, the nearest, patches pending. */
      terrain: () => ({ ...TERRAIN_STATS }),
      /** Where Fly would start the glide now. */
      diveFrom: () => scene.diveFrom(),
      /** Start the glide from a point of the planet, heading this way (its own frame). */
      glideFrom: (position: Vec3, heading: Vec3) => {
        rig.fly({ position, heading })
      },
      canvas,
    },
  })
}
