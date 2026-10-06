import type { Rect } from './postcard'

/**
 * The postcard itself: the render cut to its frame, a film grain laid over
 * it, and its words in the lower left. Drawn on a 2D canvas after the
 * render rather than in the render's own grade pass, so it is the same
 * card on a phone that skips the post pass as on a desktop that has it —
 * and the preview over the live view uses the same grain tile and the same
 * proportions, so what is framed is what is sent.
 */

/** The grain tile's side, in pixels: one tile pixel to one CSS pixel on screen. */
const TILE = 128

let tile: HTMLCanvasElement | undefined

/** Grey speckle around mid-grey, made once from a hash, never from Math.random. */
export function grainTile(): HTMLCanvasElement {
  if (tile !== undefined) return tile
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const context = canvas.getContext('2d')
  if (context !== null) {
    const image = context.createImageData(TILE, TILE)
    let h = 2166136261
    for (let k = 0; k < TILE * TILE; k += 1) {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      const v = 128 + (((h ^ (h >>> 15)) >>> 0) / 4294967296 - 0.5) * 255 * 0.9
      image.data[k * 4] = v
      image.data[k * 4 + 1] = v
      image.data[k * 4 + 2] = v
      image.data[k * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }
  tile = canvas
  return canvas
}

/** How strong the grain is at a dial's 0 to 1: overlay at up to this alpha. */
export const grainAlpha = (dial: number): number => Math.min(1, Math.max(0, dial)) * 0.4

/** The words' sizes for a frame this wide, the same on the preview and the card. */
export function wordsFor(width: number): {
  readonly caption: number
  readonly line: number
  readonly margin: number
} {
  const caption = Math.max(16, Math.round(width * 0.058))
  return {
    caption,
    line: Math.max(10, Math.round(caption * 0.42)),
    margin: Math.round(width * 0.05),
  }
}

export interface Card {
  /** The frame, in CSS pixels of the viewport the picture was taken at. */
  readonly frame: Rect
  /** The viewport's width in CSS pixels: the picture's own width over this is its scale. */
  readonly viewportWidth: number
  /** The grain dial, 0 to 1. */
  readonly grain: number
  readonly caption: string
  readonly line: string
}

/** Cut, grain and caption a picture of the whole view into a postcard. */
export async function composePostcard(picture: Blob, card: Card): Promise<Blob | null> {
  const bitmap = await createImageBitmap(picture)
  const scale = bitmap.width / Math.max(1, card.viewportWidth)
  const sx = Math.round(card.frame.x * scale)
  const sy = Math.round(card.frame.y * scale)
  const width = Math.max(1, Math.min(bitmap.width - sx, Math.round(card.frame.width * scale)))
  const height = Math.max(1, Math.min(bitmap.height - sy, Math.round(card.frame.height * scale)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return null
  context.drawImage(bitmap, sx, sy, width, height, 0, 0, width, height)
  bitmap.close()

  const alpha = grainAlpha(card.grain)
  const pattern = alpha > 0 ? context.createPattern(grainTile(), 'repeat') : null
  if (pattern !== null) {
    // The tile at the picture's own scale, so a speckle is the size it was on screen.
    pattern.setTransform(new DOMMatrix().scaleSelf(scale, scale))
    context.save()
    context.globalCompositeOperation = 'overlay'
    context.globalAlpha = alpha
    context.fillStyle = pattern
    context.fillRect(0, 0, width, height)
    context.restore()
  }

  const words = wordsFor(card.frame.width)
  const caption = words.caption * scale
  const line = words.line * scale
  const margin = words.margin * scale
  const family = getComputedStyle(document.body).fontFamily
  context.save()
  context.fillStyle = '#ffffff'
  context.shadowColor = 'rgba(0, 0, 0, 0.75)'
  context.shadowBlur = 12 * scale
  context.shadowOffsetY = scale
  context.textBaseline = 'alphabetic'
  context.font = `650 ${caption.toFixed(1)}px ${family}`
  const bottom = height - margin
  if (card.caption.trim() !== '') {
    context.fillText(card.caption.trim(), margin, bottom - line * 1.5, width - margin * 2)
  }
  context.font = `500 ${line.toFixed(1)}px ${family}`
  context.fillStyle = 'rgba(232, 234, 240, 0.85)'
  context.fillText(card.line, margin, bottom, width - margin * 2)
  context.restore()

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
}
