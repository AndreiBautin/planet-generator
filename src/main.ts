import { systemClock } from '@/app/clock'
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
import { createRig } from '@/ui/rig'
import { attachWalkControls } from '@/ui/walk-controls'
import { shareLink } from '@/ui/share'

/**
 * The composition root: read config, settle the seed, start the scene and
 * wire the controls. The only file that names concrete implementations
 * (the system clock, the browser's entropy source, the worker) and the only
 * one that owns the state — which planet, at which dials.
 */
const { config, warnings } = readConfig()
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
const rig = createRig(systemClock, () => (direction) => groundRadiusAt(planet, direction))
attachGestures(canvas, systemClock, rig.gestures)
const scene = startScene(canvas, systemClock, rig.view, {
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

const modeOf = (): 'orbit' | 'flying' | 'walking' =>
  rig.walking() ? 'walking' : rig.flying() ? 'flying' : 'orbit'

const hud = attachHud({
  onNew: () => {
    // A new world is born in orbit: rising over the old one first would be
    // two seconds of a planet that is about to be replaced.
    scene.takeOff()
    rig.cut()
    hud.mode('orbit')
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
    if (rig.walking()) {
      rig.takeOff()
      scene.takeOff()
    } else if (rig.flying()) {
      const landed = scene.landOn()
      if (landed !== undefined) rig.drop(landed)
    } else {
      rig.fly(scene.diveFrom())
    }
    hud.mode(modeOf())
  },
  onOrbit: () => {
    if (rig.walking()) scene.takeOff()
    rig.land(scene.orbitOver)
    hud.mode(modeOf())
  },
  onDials: (next) => {
    dials = next
    // Replaced rather than pushed: a dial dragged across its range is one
    // decision, not forty steps for Back to walk through.
    window.history.replaceState(null, '', linkFor(seed, dials))
    void show(false)
  },
})

attachWalkControls(canvas, hud.jump, rig.walking, rig.walk)

// Arrow keys steer a glide on a keyboard, and Escape lands.
window.addEventListener('keydown', (event) => {
  if (!(rig.flying() || rig.walking()) || event.target instanceof HTMLInputElement) return
  if (rig.walking()) {
    if (event.key === 'Escape') {
      scene.takeOff()
      rig.land(scene.orbitOver)
      hud.mode('orbit')
    }
    return
  }
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
    if (rig.walking()) scene.takeOff()
    rig.land(scene.orbitOver)
    hud.mode('orbit')
  }
})

window.addEventListener('popstate', () => {
  rig.cut()
  hud.mode('orbit')
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
