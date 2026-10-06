import { CLIP_SECONDS, clipFormat, clipSize, titleStrength, type ClipFormat } from './clip'

/** What a clip is made from: the view's canvas, told of each frame as it is drawn, and its sound. */
export interface ClipSource {
  readonly canvas: HTMLCanvasElement
  readonly onFrame: (listener: (() => void) | undefined) => void
  readonly soundStream: () => MediaStream | undefined
}

export interface ClipOptions {
  /** The world's name, over the opening seconds, and a line under it. */
  readonly title: string
  readonly subtitle: string
  /** The app's clock, in milliseconds. */
  readonly now: () => number
  /** Whole seconds left, each time it changes. */
  readonly onTick: (remaining: number) => void
  /** The finished clip, or nothing if the browser made none. */
  readonly onDone: (clip: Blob | undefined, format: ClipFormat) => void
}

export interface ClipRecording {
  /** Finish now, rather than at the full length. */
  readonly stop: () => void
}

/**
 * Record the view: every frame, as it is drawn, copied onto a canvas of
 * the clip's size with the world's name laid over the opening, and that
 * canvas streamed into the browser's encoder with the sound, if it has
 * ever been on. Copied as each frame is drawn rather than on a timer of
 * its own, because the view's canvas is cleared once a frame is shown:
 * read at any other moment it is black.
 *
 * Returns what to tell the person instead, when this browser cannot.
 */
export function recordClip(source: ClipSource, options: ClipOptions): ClipRecording | string {
  if (typeof MediaRecorder === 'undefined') return 'This browser cannot record clips'
  const format = clipFormat((mime) => MediaRecorder.isTypeSupported(mime))
  if (format === undefined) return 'This browser cannot record clips'
  const { width, height } = clipSize(source.canvas.width, source.canvas.height)
  const frame = document.createElement('canvas')
  frame.width = width
  frame.height = height
  const pen = frame.getContext('2d')
  if (pen === null) return 'This browser cannot record clips'
  const stream = frame.captureStream(30)
  for (const track of source.soundStream()?.getAudioTracks() ?? []) stream.addTrack(track)
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 })
  } catch {
    return 'This browser cannot record clips'
  }
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onstop = () => {
    // Only the clip's own picture: the sound's track is the soundscape's,
    // and stopping it would silence every clip after this one.
    for (const track of stream.getVideoTracks()) track.stop()
    const type = format.mime.split(';')[0] ?? format.mime
    options.onDone(chunks.length > 0 ? new Blob(chunks, { type }) : undefined, format)
  }

  const started = options.now()
  let told = -1
  const stop = (): void => {
    source.onFrame(undefined)
    if (recorder.state !== 'inactive') recorder.stop()
  }
  source.onFrame(() => {
    const seconds = (options.now() - started) / 1000
    pen.drawImage(source.canvas, 0, 0, width, height)
    drawTitle(pen, width, height, options.title, options.subtitle, titleStrength(seconds))
    const remaining = Math.max(0, Math.ceil(CLIP_SECONDS - seconds))
    if (remaining !== told) {
      told = remaining
      options.onTick(remaining)
    }
    if (seconds >= CLIP_SECONDS) stop()
  })
  recorder.start(250)
  return { stop }
}

/** The world's name as a lower third, the tour's caption in the picture itself. */
function drawTitle(
  pen: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  strength: number,
): void {
  if (strength <= 0) return
  const unit = Math.min(width, height)
  const left = unit * 0.06
  const base = height - unit * 0.08
  pen.save()
  pen.globalAlpha = strength
  pen.shadowColor = 'rgba(0, 0, 0, 0.85)'
  pen.shadowBlur = unit * 0.025
  pen.fillStyle = '#f2f4f7'
  pen.font = `650 ${String(Math.round(unit * 0.075))}px system-ui, sans-serif`
  pen.fillText(title, left, base - unit * 0.045)
  pen.fillStyle = 'rgba(242, 244, 247, 0.75)'
  pen.font = `500 ${String(Math.round(unit * 0.03))}px system-ui, sans-serif`
  pen.fillText(subtitle.toUpperCase(), left, base)
  pen.restore()
}
