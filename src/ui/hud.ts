import { KINDS } from '@/generation/kinds'
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
  /** Fly when orbiting, land when flying. */
  readonly onFly: () => void
  /** Start a tour (flying off if in orbit), or stop one. */
  readonly onTour: () => void
  /** Take a picture of the view. */
  readonly onPhoto: () => void
}

export interface Hud {
  readonly render: (planet: Planet) => void
  readonly toast: (message: string) => void
  /** Say whether the camera is flying: the button's word, and the hint. */
  readonly flying: (flying: boolean) => void
  /** Say whether the glide is flying itself. */
  readonly touring: (touring: boolean) => void
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
  element('share', HTMLButtonElement).addEventListener('click', handlers.onShare)
  const fly = element('fly', HTMLButtonElement)
  fly.addEventListener('click', handlers.onFly)
  const tour = element('tour', HTMLButtonElement)
  tour.addEventListener('click', handlers.onTour)
  element('photo', HTMLButtonElement).addEventListener('click', handlers.onPhoto)
  tune.addEventListener('click', () => {
    panel.hidden = !panel.hidden
    tune.setAttribute('aria-pressed', String(!panel.hidden))
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
    flying: (flying) => {
      fly.textContent = flying ? 'Land' : 'Fly'
      fly.setAttribute('aria-pressed', String(flying))
      document.body.classList.toggle('flying', flying)
    },
    touring: (touring) => {
      tour.setAttribute('aria-pressed', String(touring))
      document.body.classList.toggle('touring', touring)
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
