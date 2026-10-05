import { systemClock } from '@/app/clock'
import { readConfig } from '@/app/config'
import { linkFor, parseLink } from '@/app/link'
import { createPlanet, DEFAULT_DIALS, type Dials, type Planet } from '@/generation/planet'
import { newSeed, type Seed } from '@/generation/seed'
import { createBuilder } from '@/render/builder'
import { groundRadiusAt } from '@/render/patches/patch-data'
import { pickQuality } from '@/render/quality'
import { plotFrameOf, startScene } from '@/render/scene'
import { logger, setLogLevel } from '@/shared/logger'
import { attachGestures } from '@/ui/controls'
import { attachHud } from '@/ui/hud'
import { createRig } from '@/ui/rig'
import { attachWalkControls } from '@/ui/walk-controls'
import {
  loadFelled,
  loadHold,
  loadLogbook,
  loadPlot,
  loadPlots,
  loadShip,
  saveFelled,
  saveHold,
  saveLogbook,
  savePlot,
  saveShip,
  type LogEntry,
} from '@/app/saves'
import { grown, type TimedEdit } from '@/generation/growth'
import {
  cacheOf,
  scopeInFlight,
  scopeOnFoot,
  type Cache,
  type ScopeReading,
} from '@/generation/cache'
import { angleBetween, surveyPlanet } from '@/generation/landmarks'
import {
  fit,
  hasFound,
  hasModule,
  holdCapacity,
  openCache,
  holdTotal,
  jump,
  landingGate,
  MODULE_SPECS,
  newShip,
  offeredWorlds,
  reachOf,
  type Ship,
} from '@/generation/expedition'
import { pickKind } from '@/generation/kinds'
import { createRng } from '@/generation/rng'
import { columnOf, type Block, type Frame } from '@/generation/voxel'
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
// Where this world's cache is, and the clue to it; surveyed once per planet.
const caches = new WeakMap<Planet, Cache>()
const cacheFor = (world: Planet): Cache => {
  const known = caches.get(world)
  if (known !== undefined) return known
  const cache = cacheOf(world, surveyPlanet(world))
  caches.set(world, cache)
  return cache
}
let cache: Cache = cacheFor(planet)
// The scope's last word, so the HUD is only touched when it changes.
let scope: ScopeReading | undefined
const unit = (v: readonly [number, number, number]): readonly [number, number, number] => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
const rig = createRig(systemClock, () => (direction) => groundRadiusAt(planet, direction))
attachGestures(canvas, systemClock, rig.gestures)
const scene = startScene(canvas, systemClock, rig.view, {
  quality,
  builder: createBuilder(navigator.hardwareConcurrency),
  onView: (view) => {
    let reading: ScopeReading | undefined
    if (hasModule(ship, 'scope') && !hasFound(ship, seed)) {
      const near =
        plotFrame !== undefined &&
        plotFrame.origin[0] * cache.direction[0] +
          plotFrame.origin[1] * cache.direction[1] +
          plotFrame.origin[2] * cache.direction[2] >
          0.9
      if (view.walk !== undefined && plotFrame !== undefined) {
        // `columnOf` projects through the planet's centre, so a cache on
        // the far side would read as close; on foot it is cold unless the
        // plot is on the cache's own side.
        const [cx, cz] = columnOf(plotFrame, cache.direction)
        reading = near ? scopeOnFoot(Math.hypot(view.walk.x - cx, view.walk.z - cz)) : 'cold'
      } else if (view.surface !== undefined && view.walk === undefined) {
        reading = scopeInFlight(angleBetween(unit(view.surface.eye), cache.direction))
      }
    }
    if (reading === scope) return
    scope = reading
    hud.scope(reading)
  },
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
  cache = cacheFor(next)
  hud.render(next)
  showShip()
  void loadFelled(seed).then((ids) => {
    felled = ids
    scene.setFelled(ids)
  })
  void showMarks()
  document.body.classList.add('forming')
  // False when a later planet was asked for first; that one will clear the
  // forming state when it arrives.
  if (!(await scene.show(next, { born }))) return
  document.body.classList.remove('forming')
  logger.info('planet.shown', { seed, kind: next.kind })
}

const modeOf = (): 'orbit' | 'flying' | 'walking' =>
  rig.walking() ? 'walking' : rig.flying() ? 'flying' : 'orbit'

// The hold: what has been dug, on any world, and which block is held to
// build with. It is the ship's, so it travels; the plot edits are the
// world's and stay.
let hold: Partial<Record<Block, number>> = {}
let held: Block | undefined
let plot: string | undefined
let plotFrame: Frame | undefined
// When each sapling on the current plot went in, by block key: what makes it grow.
let planted = new Map<number, number>()
// The placements felled on this world, left out of the glide.
let felled: readonly string[] = []
/** The current plot's edits, with the planting times the view does not hold. */
const timedChanges = (): readonly TimedEdit[] =>
  scene.changes().map(([key, block]) => {
    const at = planted.get(key)
    return block === 'sapling' && at !== undefined ? [key, block, at] : [key, block]
  })
/** Draw every mark left on this world from the air. */
const showMarks = async (): Promise<void> => {
  const world = seed
  const plots = await loadPlots(world)
  if (world !== seed) return
  scene.setMarks(
    plots.flatMap(({ name, save }) => {
      const frame = plotFrameOf(name)
      return frame === undefined ? [] : [{ name, frame, edits: save.edits }]
    }),
  )
}
const showHold = (): void => {
  if (held !== undefined && (hold[held] ?? 0) <= 0) held = undefined
  if (held === undefined) {
    const first = Object.entries(hold).find(([, count]) => count > 0)
    held = first?.[0] as Block | undefined
  }
  hud.hold(hold, held)
}
let saving: ReturnType<typeof setTimeout> | undefined
/** Save the plot and the hold now, for the world and plot as they are at this moment. */
const saveNow = async (): Promise<void> => {
  if (saving !== undefined) clearTimeout(saving)
  saving = undefined
  const world = seed
  const here = plot
  await Promise.all([
    here === undefined ? undefined : savePlot(world, here, { edits: timedChanges() }),
    saveHold({ counts: hold }),
  ])
}
const saveSoon = (): void => {
  if (saving !== undefined) clearTimeout(saving)
  saving = setTimeout(() => {
    void saveNow()
  }, 400)
}
/** Leave the ground: the plot saved first, so the marks drawn from the air are the ones left. */
const leaveGround = (): void => {
  if (plot === undefined) return
  void saveNow().then(() => showMarks())
  // Forgotten before the ground goes: a save after take-off would read an
  // empty landing and write the plot as empty.
  plot = undefined
  plotFrame = undefined
  scene.takeOff()
}

// The ship outlives any one world. It is loaded once; until then a fresh
// one on an expedition seeded from this world stands in.
let ship: Ship = newShip(seed)
let logbook: LogEntry[] = []
const showShip = (): void => {
  const kinds: Record<string, ReturnType<typeof pickKind>> = {}
  for (const offered of offeredWorlds(ship.expedition, ship.jumps)) {
    kinds[offered] = pickKind(createRng(offered).fork('kind'))
  }
  hud.ship({
    ship,
    hold,
    kinds,
    logged: logbook.length,
    clue: cache.clue,
    found: hasFound(ship, seed),
  })
  scene.setShip(ship)
  scene.setReach(reachOf(ship))
}
void Promise.all([loadShip(), loadLogbook(), loadHold()]).then(([saved, log, theHold]) => {
  if (saved !== undefined) ship = saved
  logbook = log
  hold = { ...theHold.counts }
  showShip()
  showHold()
})

/** Land on the plot under the glide, with whatever was dug there before laid back over it. */
const dropIn = async (): Promise<void> => {
  const gate = landingGate(ship, planet.kind)
  if (gate !== undefined) {
    hud.toast(`The ship needs ${MODULE_SPECS[gate].name.toLowerCase()} to land here`)
    return
  }
  const under = scene.plotUnder()
  if (under === undefined) return
  const saved = await loadPlot(seed, under.name)
  if (!rig.flying()) return
  // Saplings planted long enough ago come up as trees, saved back as such.
  const edits = grown(saved.edits, systemClock.now())
  if (edits !== saved.edits) void savePlot(seed, under.name, { edits })
  planted = new Map(
    edits.flatMap(([key, block, at]) =>
      block === 'sapling' && at !== undefined ? [[key, at]] : [],
    ),
  )
  plot = under.name
  plotFrame = under.frame
  rig.drop(
    scene.landOn(
      under,
      edits.map(([key, block]) => [key, block] as const),
    ),
  )
  hud.mode(modeOf())
  showHold()
}

const hud = attachHud({
  onNew: () => {
    // A new world is born in orbit: rising over the old one first would be
    // two seconds of a planet that is about to be replaced.
    leaveGround()
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
      leaveGround()
      rig.takeOff()
    } else if (rig.flying()) {
      void dropIn()
    } else {
      rig.fly(scene.diveFrom())
    }
    hud.mode(modeOf())
  },
  onHold: (block) => {
    held = block
    showHold()
  },
  onFit: (module) => {
    const fitted = fit(ship, hold, module)
    if (fitted.ship === ship) return
    ship = fitted.ship
    hold = { ...fitted.hold }
    void saveShip(ship)
    void saveHold({ counts: hold })
    hud.toast(`${MODULE_SPECS[module].name} fitted`)
    showShip()
    showHold()
  },
  onJump: (next) => {
    const flown = jump(ship)
    if (flown === undefined) return
    ship = flown
    void saveShip(ship)
    leaveGround()
    rig.cut()
    hud.mode('orbit')
    seed = next
    dials = DEFAULT_DIALS
    window.history.pushState(null, '', linkFor(seed, dials))
    void show(true)
    showShip()
  },
  onNewExpedition: () => {
    logbook = [
      ...logbook,
      {
        expedition: ship.expedition,
        worlds: ship.jumps,
        modules: ship.modules.length,
        endedAt: systemClock.now(),
      },
    ]
    void saveLogbook(logbook)
    ship = newShip(freshSeed())
    void saveShip(ship)
    hud.toast('A new expedition. The ship is bare again.')
    showShip()
  },
  onOrbit: () => {
    leaveGround()
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

attachWalkControls(canvas, hud.jump, hud.place, systemClock, rig.walking, rig.walk, {
  dig: () => {
    if (holdTotal(hold) >= holdCapacity(ship)) {
      hud.toast('The hold is full')
      return
    }
    const dug = scene.breakBlock()
    if (dug === undefined || dug.block === 'air') return
    if (dug.felled !== undefined && !felled.includes(dug.felled)) {
      felled = [...felled, dug.felled]
      void saveFelled(seed, felled)
      scene.setFelled(felled)
    }
    if (dug.block === 'sapling') planted.delete(dug.key)
    if (dug.block === 'cache') {
      // The cache is never a block in the hold: it is opened where it lies.
      const opened = openCache(ship, hold, seed)
      ship = opened.ship
      hold = { ...opened.hold }
      void saveShip(ship)
      hud.toast('The cache: parts for the ship, and fuel for two more jumps')
      showShip()
      showHold()
      saveSoon()
      return
    }
    // A crown dug gives a sapling one time in four, decided by the block's
    // key so the same leaves always give the same thing.
    const got: Block =
      (dug.block === 'leaves' || dug.block === 'needles') &&
      (Math.imul(dug.key, 2654435761) >>> 0) % 4 === 0
        ? 'sapling'
        : dug.block
    hold[got] = (hold[got] ?? 0) + 1
    showHold()
    saveSoon()
  },
  build: () => {
    if (held === undefined || (hold[held] ?? 0) <= 0) return
    const key = scene.placeBlock(held)
    if (key === undefined) return
    if (held === 'sapling') planted.set(key, systemClock.now())
    hold[held] = (hold[held] ?? 0) - 1
    showHold()
    saveSoon()
  },
})

// Arrow keys steer a glide on a keyboard, and Escape lands.
window.addEventListener('keydown', (event) => {
  if (!(rig.flying() || rig.walking()) || event.target instanceof HTMLInputElement) return
  if (rig.walking()) {
    if (event.key === 'Escape') {
      leaveGround()
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
    leaveGround()
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
