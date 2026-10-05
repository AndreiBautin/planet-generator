import { systemClock } from '@/app/clock'
import { readConfig } from '@/app/config'
import { KINDS } from '@/generation/kinds'
import { createPlanet } from '@/generation/planet'
import { newSeed, parseSeed } from '@/generation/seed'
import { startScene } from '@/render/scene'
import { attachOrbit } from '@/ui/controls'
import { logger, setLogLevel } from '@/shared/logger'

/**
 * The composition root: read config, settle the seed, start the scene.
 * The only file that names concrete implementations (the system clock,
 * the browser's entropy source).
 */
const { config, warnings } = readConfig()
setLogLevel(config.logLevel)
for (const warning of warnings) logger.warn('config.invalid', { warning })

// The seed lives in the URL, so the address bar is the share button.
const url = new URL(window.location.href)
const seed =
  parseSeed(url.searchParams.get('seed')) ??
  newSeed((bytes) => {
    crypto.getRandomValues(bytes)
  })
if (url.searchParams.get('seed') !== seed) {
  url.searchParams.set('seed', seed)
  window.history.replaceState(null, '', url)
}

const planet = createPlanet(seed)

const label = document.getElementById('seed')
if (label !== null)
  label.textContent = `${planet.name} · ${KINDS[planet.kind].label} · seed ${seed}`

// The canvas is made here so the controls and the scene can share it
// without either knowing about the other: render/ never imports ui/.
const canvas = document.createElement('canvas')
document.body.prepend(canvas)
const orbit = attachOrbit(canvas, systemClock)
startScene(canvas, planet, systemClock, orbit.current)
logger.info('planet.started', { seed })
