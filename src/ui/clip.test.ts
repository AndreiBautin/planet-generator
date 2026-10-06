import { describe, expect, it } from 'vitest'

import { CLIP_WIDTH, clipFormat, clipName, clipSize, titleStrength } from './clip'

describe('clips', () => {
  it('records MP4 where it can, WebM where it cannot, and nothing where neither', () => {
    expect(clipFormat(() => true)?.extension).toBe('mp4')
    expect(clipFormat((mime) => mime.startsWith('video/webm'))?.extension).toBe('webm')
    expect(clipFormat(() => false)).toBeUndefined()
  })

  it("draws no wider than the clip width, keeping the view's shape, in even sizes", () => {
    const { width, height } = clipSize(2560, 1441)
    expect(width).toBe(CLIP_WIDTH)
    expect(width % 2).toBe(0)
    expect(height % 2).toBe(0)
    expect(height / width).toBeCloseTo(1441 / 2560, 2)
    // A small view is not blown up.
    expect(clipSize(390, 844)).toEqual({ width: 390, height: 844 })
  })

  it('shows the name in the opening seconds only', () => {
    expect(titleStrength(0)).toBe(0)
    expect(titleStrength(2)).toBe(1)
    expect(titleStrength(5)).toBe(0)
  })

  it('names the file after the world, safely', () => {
    expect(clipName('Quorthekru-89')).toBe('Quorthekru-89-flythrough')
    expect(clipName('  /..  ')).toBe('planet-flythrough')
  })
})
