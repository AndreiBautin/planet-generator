import { describe, expect, it } from 'vitest'

import {
  DROPPED_SHARE,
  droppedShare,
  nextPixelRatio,
  pickQuality,
  SLOW_FRAME_MS,
  typicalFrame,
} from './quality'

describe('pickQuality', () => {
  it('draws less on a phone than on a desktop', () => {
    const phone = pickQuality({ width: 390, height: 844, pixelRatio: 3, cores: 6 })
    const desktop = pickQuality({ width: 1920, height: 1080, pixelRatio: 1, cores: 12 })
    expect(phone.lodThreshold).toBeGreaterThan(desktop.lodThreshold)
    expect(phone.maxLevel).toBeLessThanOrEqual(desktop.maxLevel)
    expect(phone.cloudWidth).toBeLessThan(desktop.cloudWidth)
  })

  it('never renders above twice the CSS resolution', () => {
    expect(pickQuality({ width: 390, height: 844, pixelRatio: 3, cores: 8 }).pixelRatio).toBe(2)
  })

  it('treats a device that hides its core count as a modest one', () => {
    const hidden = pickQuality({ width: 390, height: 844, pixelRatio: 3, cores: 0 })
    const strong = pickQuality({ width: 390, height: 844, pixelRatio: 3, cores: 8 })
    expect(hidden.lodThreshold).toBeGreaterThan(strong.lodThreshold)
  })

  it('keeps cloud textures a power of two wide', () => {
    for (const width of [390, 1920]) {
      const { cloudWidth } = pickQuality({ width, height: 900, pixelRatio: 1, cores: 8 })
      expect(Math.log2(cloudWidth) % 1).toBe(0)
    }
  })
})

describe('typicalFrame', () => {
  it('is not moved by one long frame', () => {
    expect(typicalFrame([16, 17, 16, 400, 17])).toBe(17)
  })

  it('reads an empty run as nothing measured', () => {
    expect(typicalFrame([])).toBe(0)
  })
})

describe('nextPixelRatio', () => {
  it('leaves a smooth device alone', () => {
    expect(nextPixelRatio(2, 16)).toBe(2)
    expect(nextPixelRatio(2, SLOW_FRAME_MS)).toBe(2)
  })

  it('steps a slow device down one step at a time', () => {
    expect(nextPixelRatio(2, 40)).toBe(1.5)
    expect(nextPixelRatio(1.5, 40)).toBe(1.25)
  })

  it('stops at the floor, which is below one', () => {
    expect(nextPixelRatio(1, 80)).toBe(0.75)
    expect(nextPixelRatio(0.75, 80)).toBe(0.75)
  })

  it('steps down for dropped frames though the typical frame is on time', () => {
    // 90 frames at 16.7 ms with 4 of them a skipped refresh: the median is
    // fine and the picture stutters.
    const window = Array.from({ length: 90 }, (_, k) => (k % 22 === 0 ? 33 : 16.7))
    expect(typicalFrame(window)).toBeLessThan(SLOW_FRAME_MS)
    expect(droppedShare(window)).toBeGreaterThan(DROPPED_SHARE)
    expect(nextPixelRatio(1, typicalFrame(window), droppedShare(window))).toBe(0.75)
    // One drop in ninety is left alone.
    const once = Array.from({ length: 90 }, (_, k) => (k === 5 ? 33 : 16.7))
    expect(nextPixelRatio(1, typicalFrame(once), droppedShare(once))).toBe(1)
  })

  it('steps an in-between ratio to the next one below it', () => {
    expect(nextPixelRatio(1.75, 40)).toBe(1.5)
  })
})
