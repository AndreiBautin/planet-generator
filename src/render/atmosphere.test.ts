import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { sunlightThrough } from './atmosphere'

describe('sunlight through the air', () => {
  it('is white overhead and reddens as an earthly sun sets', () => {
    const blueAir = { r: 0.35, g: 0.6, b: 1 }
    const noon = sunlightThrough(blueAir, 1, new THREE.Color())
    expect(noon.r).toBeCloseTo(1, 5)
    expect(noon.b).toBeCloseTo(1, 5)
    const dusk = sunlightThrough(blueAir, 0.05, new THREE.Color())
    expect(dusk.r).toBeGreaterThan(dusk.g)
    expect(dusk.g).toBeGreaterThan(dusk.b)
  })

  it('takes out whatever colour the air scatters, so a red sky gives a blue-green sunset', () => {
    const redAir = { r: 1, g: 0.4, b: 0.3 }
    const dusk = sunlightThrough(redAir, 0.05, new THREE.Color())
    expect(dusk.b).toBeGreaterThan(dusk.r)
  })
})
