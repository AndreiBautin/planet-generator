/**
 * Flythrough clips: what the view does for a few seconds, kept as a video
 * with the world's name over the opening. The choices here are pure, so
 * they are tested; the recording itself is `clip-recorder.ts`.
 */

/** How long a clip runs unless stopped sooner, seconds. */
export const CLIP_SECONDS = 10
/** The widest a clip is drawn: a phone's sharing does not want more, and the encoder keeps up. */
export const CLIP_WIDTH = 1280

export interface ClipFormat {
  readonly mime: string
  readonly extension: 'mp4' | 'webm'
}

/**
 * The container to record in: MP4 where the browser can make one, since
 * it is what every phone plays and every share sheet takes; WebM where it
 * cannot. None when it can record neither.
 */
export function clipFormat(supported: (mime: string) => boolean): ClipFormat | undefined {
  const choices: readonly ClipFormat[] = [
    { mime: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mime: 'video/mp4', extension: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mime: 'video/webm', extension: 'webm' },
  ]
  return choices.find((choice) => supported(choice.mime))
}

/** The size a clip is drawn at for a view this size: no wider than `CLIP_WIDTH`, even on both sides as encoders want. */
export function clipSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, CLIP_WIDTH / Math.max(1, width))
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

/** How strongly the world's name shows `seconds` into a clip: in after a beat, held, gone by four seconds. */
export function titleStrength(seconds: number): number {
  const rise = Math.min(1, Math.max(0, (seconds - 0.4) / 0.8))
  const fall = Math.min(1, Math.max(0, (4 - seconds) / 0.8))
  return Math.min(rise, fall)
}

/** What a clip is called when it is saved. */
export function clipName(world: string): string {
  const safe = world.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${safe.length > 0 ? safe : 'planet'}-flythrough`
}
