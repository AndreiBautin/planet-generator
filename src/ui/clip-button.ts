import type { ClipFormat } from './clip'
import type { ClipRecording } from './clip-recorder'

/**
 * The clip button: press to record, the seconds left counting down on it,
 * press again to stop early. When the clip is made the button offers it —
 * a press to save or share — rather than saving it there and then: the
 * share sheet only opens inside a press, and ten seconds on, the press that
 * started the clip no longer counts as one.
 */
export interface ClipButtonHandlers {
  /** Start recording; a message instead when it cannot. */
  readonly start: (handlers: {
    readonly onTick: (remaining: number) => void
    readonly onDone: (clip: Blob | undefined, format: ClipFormat) => void
  }) => ClipRecording | string
  /** Save or share a finished clip; what to say, if anything. */
  readonly save: (clip: Blob, format: ClipFormat) => Promise<string | undefined>
  readonly tell: (message: string) => void
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'recording'; readonly recording: ClipRecording }
  | { readonly kind: 'ready'; readonly clip: Blob; readonly format: ClipFormat }

export function attachClipButton(handlers: ClipButtonHandlers): void {
  const button = document.getElementById('clip')
  const count = document.getElementById('clip-count')
  if (!(button instanceof HTMLButtonElement) || count === null)
    throw new Error('index.html is missing #clip')
  let state: State = { kind: 'idle' }

  const show = (next: State): void => {
    state = next
    button.dataset.state = next.kind
    if (next.kind === 'idle') {
      button.setAttribute('aria-label', 'Record a clip')
      count.textContent = ''
    } else if (next.kind === 'recording') {
      button.setAttribute('aria-label', 'Stop recording')
    } else {
      button.setAttribute('aria-label', 'Save the clip')
      count.textContent = ''
    }
  }

  button.addEventListener('click', () => {
    if (state.kind === 'recording') {
      state.recording.stop()
      return
    }
    if (state.kind === 'ready') {
      const { clip, format } = state
      show({ kind: 'idle' })
      void handlers.save(clip, format).then((message) => {
        if (message !== undefined) handlers.tell(message)
      })
      return
    }
    const started = handlers.start({
      onTick: (remaining) => {
        count.textContent = String(remaining)
      },
      onDone: (clip) => {
        if (clip === undefined) {
          show({ kind: 'idle' })
          handlers.tell('The clip came out empty')
          return
        }
        show({ kind: 'ready', clip, format: formatOf(clip) })
        handlers.tell('Clip ready · tap to save')
      },
    })
    if (typeof started === 'string') {
      handlers.tell(started)
      return
    }
    show({ kind: 'recording', recording: started })
  })
  show({ kind: 'idle' })
}

const formatOf = (clip: Blob): ClipFormat =>
  clip.type.includes('mp4')
    ? { mime: clip.type, extension: 'mp4' }
    : { mime: clip.type, extension: 'webm' }
