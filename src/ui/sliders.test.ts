import { describe, expect, it } from 'vitest'
import { fillOf } from './sliders'

describe('fillOf', () => {
  it('runs from the minimum to the maximum, whatever their signs', () => {
    expect(fillOf(-100, -100, 100)).toBe(0)
    expect(fillOf(0, -100, 100)).toBe(50)
    expect(fillOf(100, -100, 100)).toBe(100)
  })

  it('stays on the track for a value past its ends or a range with none', () => {
    expect(fillOf(140, 0, 100)).toBe(100)
    expect(fillOf(3, 5, 5)).toBe(0)
  })
})
