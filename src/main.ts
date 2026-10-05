import { systemClock } from '@/app/clock'
import { readConfig } from '@/app/config'
import { linkFor, parseLink } from '@/app/link'
import { createPlanet, DEFAULT_DIALS, type Dials } from '@/generation/planet'
import { newSeed, type Seed } from '@/generation/seed'
import { startScene } from '@/render/scene'
import { logger, setLogLevel } from '@/shared/logger'
import { attachOrbit } from '@/ui/controls'
import { attachHud } from '@/ui/hud'
import { shareLink } from '@/ui/share'

/**
 * The composition root: read config, settle the seed, start the scene and
 * wire the controls. The only file that names concrete implementations
 * (the system clock, the browser's entropy source) and the only one that
 * owns the state — which planet, at which dials.
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

// The canvas is made here so the controls and the scene can share it
// without either knowing about the other: render/ never imports ui/.
const canvas = document.createElement('canvas')
canvas.setAttribute('aria-label', 'The planet. Drag to turn it, pinch or scroll to zoom.')
canvas.setAttribute('role', 'img')
document.body.prepend(canvas)
const orbit = attachOrbit(canvas, systemClock)
const scene = startScene(canvas, systemClock, orbit.current)

const show = (): void => {
  const planet = createPlanet(seed, dials)
  scene.show(planet)
  hud.render(planet)
  logger.info('planet.shown', { seed, kind: planet.kind })
}

const hud = attachHud({
  onNew: () => {
    seed = freshSeed()
    dials = DEFAULT_DIALS
    window.history.pushState(null, '', linkFor(seed, dials))
    show()
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
    show()
  },
})

window.addEventListener('popstate', () => {
  const link = parseLink(window.location.search)
  seed = link.seed ?? freshSeed()
  dials = link.dials
  show()
})

window.history.replaceState(null, '', linkFor(seed, dials))
show()
