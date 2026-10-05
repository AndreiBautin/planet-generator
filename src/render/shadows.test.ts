import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { installSteadyShadows } from './shadows'

describe('steady shadows', () => {
  it("takes on this three.js: no per-pixel noise in the filter, and a fade at the box's edge", () => {
    expect(installSteadyShadows()).toBe(true)
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment
    expect(chunk).not.toContain('float phi = interleavedGradientNoise')
    expect(chunk).toContain('shadowEdge')
  })
})
