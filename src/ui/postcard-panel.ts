import { grainAlpha, grainTile, wordsFor } from './postcard-card'
import { clockLabel, FRAMINGS, frameIn, type Framing, type Rect } from './postcard'

/**
 * Postcard mode's controls: the frame laid over the live view (dimmed
 * outside, thirds inside, the grain and the words drawn as the card will
 * have them), and a panel of framing, time of day, height, grain and a
 * caption. The markup is in index.html; this wires it, and owns only what
 * the panel shows — the camera and the clock are the caller's.
 */
export interface PostcardHandlers {
  /** The time of day moved, 0 to 24. */
  readonly onHour: (hour: number) => void
  /** The height moved, 0 to 1 along its range. */
  readonly onHeight: (t: number) => void
  readonly onSend: () => void
  readonly onClose: () => void
}

export interface PostcardOpening {
  readonly hour: number
  /** 0 to 1 along the height's range. */
  readonly height: number
  readonly caption: string
  /** What the small line under the caption says before the hour: "Ocean world". */
  readonly kind: string
}

export interface PostcardPanel {
  readonly open: (opening: PostcardOpening) => void
  readonly close: () => void
  readonly isOpen: () => boolean
  /** Show the hour as it is now, unless the slider is in a finger's hold. */
  readonly showHour: (hour: number) => void
  /** What to send: the frame in CSS pixels, the grain dial, the words. */
  readonly card: () => {
    readonly frame: Rect
    readonly grain: number
    readonly caption: string
    readonly line: string
  }
}

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`index.html is missing #${id}`)
  return found
}

/** The frame sits this far in from the edges of the view above the panel. */
const MARGIN = 14

export function attachPostcard(handlers: PostcardHandlers): PostcardPanel {
  const root = element('postcard', HTMLElement)
  const frameBox = element('postcard-frame', HTMLElement)
  const grainBox = element('postcard-grain', HTMLElement)
  const captionShown = element('postcard-caption-shown', HTMLElement)
  const lineShown = element('postcard-line', HTMLElement)
  const panel = element('postcard-panel', HTMLElement)
  const hourInput = element('postcard-hour', HTMLInputElement)
  const timeShown = element('postcard-time', HTMLOutputElement)
  const heightInput = element('postcard-height', HTMLInputElement)
  const grainInput = element('postcard-grain-dial', HTMLInputElement)
  const text = element('postcard-text', HTMLInputElement)
  const framingButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-framing]')]

  grainBox.style.backgroundImage = `url(${grainTile().toDataURL()})`
  let framing: Framing = 'screen'
  let kind = ''
  let frame: Rect = { x: 0, y: 0, width: 1, height: 1 }
  let open = false
  let sliding = false

  const hour = (): number => Number(hourInput.value) / 60
  const line = (): string => `${kind} · ${clockLabel(hour())}`

  /** Fit the frame to the view above the panel, and the words to the frame. */
  const layout = (): void => {
    if (!open) return
    const panelTop = panel.getBoundingClientRect().top
    const area = { x: 0, y: 0, width: window.innerWidth, height: Math.max(80, panelTop) }
    frame = frameIn(framing, area, MARGIN)
    frameBox.style.left = `${String(frame.x)}px`
    frameBox.style.top = `${String(frame.y)}px`
    frameBox.style.width = `${String(frame.width)}px`
    frameBox.style.height = `${String(frame.height)}px`
    const words = wordsFor(frame.width)
    frameBox.style.setProperty('--caption', `${String(words.caption)}px`)
    frameBox.style.setProperty('--line', `${String(words.line)}px`)
    frameBox.style.setProperty('--margin', `${String(words.margin)}px`)
  }
  const words = (): void => {
    captionShown.textContent = text.value
    lineShown.textContent = line()
    timeShown.value = clockLabel(hour())
  }
  const grain = (): void => {
    grainBox.style.opacity = String(grainAlpha(Number(grainInput.value) / 100))
  }
  const choose = (next: Framing): void => {
    framing = next
    for (const button of framingButtons) {
      button.setAttribute('aria-checked', String(button.dataset['framing'] === next))
    }
    layout()
  }

  for (const button of framingButtons) {
    const value = button.dataset['framing']
    if (value !== undefined && value in FRAMINGS) {
      button.addEventListener('click', () => {
        choose(value as Framing)
      })
    }
  }
  hourInput.addEventListener('input', () => {
    words()
    handlers.onHour(hour())
  })
  // A finger on the slider owns it: the hour read back from the view must not tug it.
  hourInput.addEventListener('pointerdown', () => {
    sliding = true
  })
  window.addEventListener('pointerup', () => {
    sliding = false
  })
  heightInput.addEventListener('input', () => {
    handlers.onHeight(Number(heightInput.value) / 1000)
  })
  grainInput.addEventListener('input', grain)
  text.addEventListener('input', words)
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handlers.onSend()
  })
  element('postcard-send', HTMLButtonElement).addEventListener('click', handlers.onSend)
  element('postcard-cancel', HTMLButtonElement).addEventListener('click', handlers.onClose)
  window.addEventListener('resize', layout)

  return {
    open: (opening) => {
      open = true
      kind = opening.kind
      hourInput.value = String(Math.round(opening.hour * 60))
      heightInput.value = String(Math.round(opening.height * 1000))
      text.value = opening.caption
      root.hidden = false
      document.body.classList.add('postcarding')
      choose(framing)
      words()
      grain()
    },
    close: () => {
      open = false
      root.hidden = true
      document.body.classList.remove('postcarding')
    },
    isOpen: () => open,
    showHour: (next) => {
      if (!open || sliding || document.activeElement === hourInput) return
      const minutes = Math.round(next * 60) % 1440
      if (Math.abs(minutes - Number(hourInput.value)) < 1) return
      hourInput.value = String(minutes)
      words()
    },
    card: () => ({
      frame,
      grain: Number(grainInput.value) / 100,
      caption: text.value,
      line: line(),
    }),
  }
}
