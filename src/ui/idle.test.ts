import { describe, expect, it } from 'vitest'
import { IDLE_MS, isIdle } from './idle'

describe('isIdle', () => {
  it('never hides the chrome over an orbit, however long untouched', () => {
    expect(isIdle(false, IDLE_MS * 100)).toBe(false)
  })

  it('hides it under way only once the wait has passed', () => {
    expect(isIdle(true, IDLE_MS - 1)).toBe(false)
    expect(isIdle(true, IDLE_MS)).toBe(true)
  })
})
