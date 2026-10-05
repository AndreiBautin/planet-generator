import { systemClock } from '@/app/clock'
import { readConfig } from '@/app/config'
import { linkFor, parseLink } from '@/app/link'
import { createPlanet, DEFAULT_DIALS, type Dials } from '@/generation/planet'
import { newSeed, type Seed } from '@/generation/seed'
import { createBuilder } from '@/render/builder'
import { pickQuality } from '@/render/quality'
import { startScene } from '@/render/scene'
import { logger, setLogLevel } from '@/shared/logger'
import { attachOrbit } from '@/ui/controls'
import { attachHud } from '@/ui/hud'
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
const orbit = attachOrbit(canvas, systemClock)
const scene = startScene(canvas, systemClock, orbit.current, {
  quality,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
})
const builder = createBuilder()

/**
 * Show the current seed and dials. A new world is born; a dial moved on the
 * same world just changes, because a planet swelling from nothing every time
 * the sea rises a notch would be a show nobody asked for.
 */
const show = async (born: boolean): Promise<void> => {
  const planet = createPlanet(seed, dials)
  hud.render(planet)
  document.body.classList.add('forming')
  const built = await builder.build({
    seed,
    dials,
    detail: quality.detail,
    cloudWidth: scene.hasCloudsFor(planet) ? 0 : quality.cloudWidth,
  })
  // A later request has superseded this one; that one will show itself.
  if (built === undefined) return
  document.body.classList.remove('forming')
  scene.show(planet, built, { born })
  logger.info('planet.shown', { seed, kind: planet.kind })
}

const hud = attachHud({
  onNew: () => {
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
  onDials: (next) => {
    dials = next
    // Replaced rather than pushed: a dial dragged across its range is one
    // decision, not forty steps for Back to walk through.
    window.history.replaceState(null, '', linkFor(seed, dials))
    void show(false)
  },
})

window.addEventListener('popstate', () => {
  const link = parseLink(window.location.search)
  const changed = link.seed !== seed
  seed = link.seed ?? freshSeed()
  dials = link.dials
  void show(changed)
})

window.history.replaceState(null, '', linkFor(seed, dials))
void show(true)
