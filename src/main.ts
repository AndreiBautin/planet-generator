import { systemClock } from '@/app/clock'
import { readConfig } from '@/app/config'
import { createRng } from '@/generation/rng'
import { newSeed, parseSeed } from '@/generation/seed'
import { startScene } from '@/render/scene'
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

const rng = createRng(seed).fork('placeholder')
const colour = Math.floor(rng.next() * 0xffffff)

const label = document.getElementById('seed')
if (label !== null) label.textContent = `seed ${seed}`

startScene(document.body, colour, systemClock)
logger.info('planet.started', { seed })
