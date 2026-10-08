import { describe, expect, it } from 'vitest'

import { boltSegments } from './bolt'

describe('a lightning bolt', () => {
  const top = [0.2, 1.0, 0.1] as const
  const foot = [0.2, 0.965, 0.1] as const
  const segments = boltSegments(3, top, foot)

  it('runs from the cloud base to the ground under the strike', () => {
    expect(segments.slice(0, 3)).toEqual([...top])
    // The main channel's last segment ends at the foot; the forks come after.
    const steps = segments.length / 6
    expect(steps).toBeGreaterThan(10)
    let endsAtFoot = false
    for (let k = 0; k < steps; k += 1) {
      const [x, y, z] = segments.slice(k * 6 + 3, k * 6 + 6)
      if (
        Math.abs((x ?? 0) - foot[0]) < 1e-9 &&
        Math.abs((y ?? 0) - foot[1]) < 1e-9 &&
        Math.abs((z ?? 0) - foot[2]) < 1e-9
      )
        endsAtFoot = true
    }
    expect(endsAtFoot).toBe(true)
  })

  it('jags, but never wanders far from the line of the strike', () => {
    const height = top[1] - foot[1]
    let widest = 0
    for (let k = 0; k < segments.length; k += 3) {
      const dx = (segments[k] ?? 0) - top[0]
      const dz = (segments[k + 2] ?? 0) - top[2]
      widest = Math.max(widest, Math.hypot(dx, dz))
    }
    expect(widest).toBeGreaterThan(height * 0.01)
    expect(widest).toBeLessThan(height * 0.6)
  })

  it('is the same bolt for the same strike and another for the next', () => {
    expect(boltSegments(3, top, foot)).toEqual(segments)
    expect(boltSegments(4, top, foot)).not.toEqual(segments)
  })
})
