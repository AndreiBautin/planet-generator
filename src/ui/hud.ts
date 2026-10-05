import type { ScopeReading } from '@/generation/cache'
import {
  fit,
  hasModule,
  holdCapacity,
  holdTotal,
  lacking,
  MODULE_SPECS,
  MODULES,
  offeredWorlds,
  type Module,
  type Ship,
} from '@/generation/expedition'
import { KINDS, type PlanetKind } from '@/generation/kinds'
import type { Seed } from '@/generation/seed'
import type { Block } from '@/generation/voxel'
import type { Dials, Planet } from '@/generation/planet'

/**
 * The controls over the planet: its name, the three buttons, and the dials.
 * The markup is in index.html, where it can be styled and read at a glance;
 * this wires it to whoever owns the state, and owns none itself.
 */
export interface HudHandlers {
  readonly onNew: () => void
  readonly onShare: () => void
  readonly onDials: (dials: Dials) => void
  /** Fly when orbiting, drop in when flying, take off when walking. */
  readonly onFly: () => void
  /** Back to orbit from a glide or a walk. */
  readonly onOrbit: () => void
  /** A block kind chosen on the hotbar. */
  readonly onHold: (block: Block) => void
  /** Fit a module from the hold. */
  readonly onFit: (module: Module) => void
  /** Jump to one of the offered worlds. */
  readonly onJump: (seed: Seed) => void
  /** Start a new expedition, the old one logged. */
  readonly onNewExpedition: () => void
}

/** What the Ship panel shows: the ship, the hold, the worlds offered, and the logbook's count. */
export interface ShipView {
  readonly ship: Ship
  readonly hold: Readonly<Partial<Record<Block, number>>>
  /** The kind of each offered world, once known; the names are the seeds. */
  readonly kinds: Readonly<Record<string, PlanetKind>>
  readonly logged: number
  /** The clue to this world's cache, and whether it has been dug up. */
  readonly clue: string
  readonly found: boolean
}

export type Mode = 'orbit' | 'flying' | 'walking'

export interface Hud {
  readonly render: (planet: Planet) => void
  readonly toast: (message: string) => void
  /** Say what the camera is doing: the buttons' words, and the hint. */
  readonly mode: (mode: Mode) => void
  /** The Jump and Place buttons, for the walk controls to listen to. */
  readonly jump: HTMLElement
  readonly place: HTMLElement
  /** Show what is in the hold and which block is held. */
  readonly hold: (counts: Readonly<Partial<Record<Block, number>>>, held: Block | undefined) => void
  /** Show the ship: fuel, hold, modules to fit, worlds to jump to. */
  readonly ship: (view: ShipView) => void
  /** What the scope reads, or nothing to show. */
  readonly scope: (reading: ScopeReading | undefined) => void
}

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`index.html is missing #${id}`)
  return found
}

/** How long a dial waits for the finger to settle before rebuilding. */
const DIAL_SETTLE_MS = 140

export function attachHud(handlers: HudHandlers): Hud {
  const name = element('name', HTMLElement)
  const kind = element('kind', HTMLElement)
  const seed = element('seed', HTMLElement)
  const panel = element('dials', HTMLElement)
  const tune = element('tune', HTMLButtonElement)
  const toastLine = element('toast', HTMLElement)
  const dials = {
    water: element('dial-water', HTMLInputElement),
    temperature: element('dial-temperature', HTMLInputElement),
    roughness: element('dial-roughness', HTMLInputElement),
  }

  element('new', HTMLButtonElement).addEventListener('click', handlers.onNew)
  const shipPanel = element('ship', HTMLElement)
  const shipToggle = element('ship-toggle', HTMLButtonElement)
  const shipFuel = element('ship-fuel', HTMLElement)
  const shipHold = element('ship-hold', HTMLElement)
  const shipModules = element('ship-modules', HTMLElement)
  const shipWorlds = element('ship-worlds', HTMLElement)
  const shipLog = element('ship-log', HTMLElement)
  const shipClue = element('ship-clue', HTMLElement)
  const scopeLine = element('scope', HTMLElement)
  shipToggle.addEventListener('click', () => {
    shipPanel.hidden = !shipPanel.hidden
    shipToggle.setAttribute('aria-pressed', String(!shipPanel.hidden))
    if (!shipPanel.hidden) {
      panel.hidden = true
      tune.setAttribute('aria-pressed', 'false')
    }
  })
  shipModules.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    const module = target.dataset.module
    if (module !== undefined) handlers.onFit(module as Module)
  })
  shipWorlds.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    if (target.dataset.new !== undefined) {
      handlers.onNewExpedition()
      return
    }
    const seed = target.dataset.seed
    if (seed !== undefined) handlers.onJump(seed as Seed)
  })
  element('share', HTMLButtonElement).addEventListener('click', handlers.onShare)
  const fly = element('fly', HTMLButtonElement)
  fly.addEventListener('click', handlers.onFly)
  const orbit = element('orbit', HTMLButtonElement)
  orbit.addEventListener('click', handlers.onOrbit)
  const hint = element('hint', HTMLElement)
  const jump = element('jump', HTMLButtonElement)
  const place = element('place', HTMLButtonElement)
  const hotbar = element('hotbar', HTMLElement)
  hotbar.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    const block = target.dataset.block
    if (block !== undefined) handlers.onHold(block as Block)
  })
  tune.addEventListener('click', () => {
    panel.hidden = !panel.hidden
    tune.setAttribute('aria-pressed', String(!panel.hidden))
    if (!panel.hidden) {
      shipPanel.hidden = true
      shipToggle.setAttribute('aria-pressed', 'false')
    }
  })

  // A rebuild takes a moment, so a dial being dragged waits for the finger
  // to pause rather than rebuilding the world on every pixel of travel.
  let pending: ReturnType<typeof setTimeout> | undefined
  const changed = (): void => {
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      handlers.onDials({
        water: Number(dials.water.value) / 100,
        temperature: Number(dials.temperature.value) / 100,
        roughness: Number(dials.roughness.value) / 100,
      })
    }, DIAL_SETTLE_MS)
  }
  for (const input of Object.values(dials)) input.addEventListener('input', changed)

  let hideToast: ReturnType<typeof setTimeout> | undefined

  return {
    render: (planet) => {
      name.textContent = planet.name
      kind.textContent = KINDS[planet.kind].label
      seed.textContent = planet.seed
      document.title = `${planet.name} · Planet Generator`
      dials.water.value = String(Math.round(planet.dials.water * 100))
      dials.temperature.value = String(Math.round(planet.dials.temperature * 100))
      dials.roughness.value = String(Math.round(planet.dials.roughness * 100))
    },
    mode: (mode) => {
      fly.textContent = mode === 'orbit' ? 'Fly' : mode === 'flying' ? 'Drop in' : 'Take off'
      fly.setAttribute('aria-pressed', String(mode !== 'orbit'))
      orbit.hidden = mode === 'orbit'
      jump.hidden = mode !== 'walking'
      place.hidden = mode !== 'walking'
      hotbar.hidden = mode !== 'walking'
      hint.textContent =
        mode === 'walking'
          ? 'Left moves · right looks · tap to dig · Place to build'
          : 'Drag to steer and climb · pinch to change height'
      document.body.classList.toggle('flying', mode !== 'orbit')
      document.body.classList.toggle('walking', mode === 'walking')
      // Restart the hint's fade for the new words.
      hint.style.animation = 'none'
      void hint.getBoundingClientRect()
      hint.style.animation = ''
    },
    jump,
    place,
    ship: ({ ship, hold, kinds, logged, clue, found }) => {
      shipClue.textContent = found ? `Found. ${clue}` : clue
      shipFuel.textContent = `Fuel ${String(ship.fuel)}`
      shipHold.textContent = `Hold ${String(holdTotal(hold))} / ${String(holdCapacity(ship))}`
      shipModules.replaceChildren()
      for (const module of MODULES) {
        const spec = MODULE_SPECS[module]
        const row = document.createElement('div')
        row.className = 'ship-row'
        const text = document.createElement('span')
        const name = document.createElement('b')
        name.textContent = spec.name
        const does = document.createElement('small')
        const short = lacking(hold, spec.cost)
        const cost = Object.entries(spec.cost)
          .map(([block, count]) => `${String(count)} ${block}`)
          .join(', ')
        does.textContent = hasModule(ship, module) ? spec.does : `${spec.does} Costs ${cost}.`
        text.append(name, does)
        row.append(text)
        if (hasModule(ship, module)) {
          row.classList.add('fitted')
          const mark = document.createElement('span')
          mark.textContent = 'Fitted'
          row.append(mark)
        } else {
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.module = module
          button.textContent = 'Fit'
          button.disabled = Object.keys(short).length > 0 || fit(ship, hold, module).ship === ship
          row.append(button)
        }
        shipModules.append(row)
      }
      shipWorlds.replaceChildren()
      if (ship.fuel <= 0) {
        const row = document.createElement('div')
        row.className = 'ship-row'
        const text = document.createElement('span')
        text.textContent = 'Out of fuel: the expedition is over.'
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.new = ''
        button.textContent = 'New expedition'
        row.append(text, button)
        shipWorlds.append(row)
      } else {
        for (const seed of offeredWorlds(ship.expedition, ship.jumps)) {
          const row = document.createElement('div')
          row.className = 'ship-row'
          const text = document.createElement('span')
          const kind = kinds[seed]
          const name = document.createElement('b')
          name.textContent = kind === undefined ? 'A world' : KINDS[kind].label
          const sub = document.createElement('small')
          sub.textContent = seed
          text.append(name, sub)
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.seed = seed
          button.textContent = 'Jump'
          row.append(text, button)
          shipWorlds.append(row)
        }
      }
      shipLog.textContent =
        logged === 0
          ? `Expedition ${ship.expedition} · jump ${String(ship.jumps + 1)}`
          : `Expedition ${ship.expedition} · jump ${String(ship.jumps + 1)} · ${String(logged)} logged`
    },
    hold: (counts, held) => {
      hotbar.replaceChildren()
      for (const [block, count] of Object.entries(counts)) {
        if (count <= 0) continue
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.block = block
        button.textContent = `${block} ${String(count)}`
        button.setAttribute('aria-pressed', String(block === held))
        hotbar.append(button)
      }
    },
    scope: (reading) => {
      scopeLine.hidden = reading === undefined
      if (reading !== undefined) scopeLine.textContent = `Scope · ${reading}`
    },
    toast: (message) => {
      toastLine.textContent = message
      toastLine.classList.add('shown')
      if (hideToast !== undefined) clearTimeout(hideToast)
      hideToast = setTimeout(() => {
        toastLine.classList.remove('shown')
      }, 1800)
    },
  }
}
