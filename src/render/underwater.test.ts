import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { underwaterAt, waterFog } from './underwater'
import { SEA_RADIUS } from './water'

describe('under the sea', () => {
  it('is under only below the surface, and fully just beneath it', () => {
    expect(underwaterAt(SEA_RADIUS + 0.01)).toBe(0)
    expect(underwaterAt(SEA_RADIUS - 0.001)).toBe(1)
    const between = underwaterAt(SEA_RADIUS - 0.0001)
    expect(between).toBeGreaterThan(0)
    expect(between).toBeLessThan(1)
  })

  it('darkens the water with depth and with the night', () => {
    const shallow = waterFog(0, 1, new THREE.Color())
    const deep = waterFog(0.02, 1, new THREE.Color())
    const night = waterFog(0, 0, new THREE.Color())
    expect(deep.g).toBeLessThan(shallow.g)
    expect(night.g).toBeLessThan(shallow.g * 0.2)
  })
})
