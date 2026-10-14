import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { drawOnlyLive, liveInstanceCount } from './instances'

describe('drawOnlyLive', () => {
  it('draws up to the last live instance, and grows back when a later one lives', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 10)
    const gone = new THREE.Matrix4().makeScale(0, 0, 0)
    const here = new THREE.Matrix4().makeTranslation(1, 2, 3)
    for (let k = 0; k < 10; k += 1) mesh.setMatrixAt(k, gone)
    mesh.setMatrixAt(1, here)
    mesh.setMatrixAt(4, here)
    drawOnlyLive(mesh)
    // The parked slot between live ones is still drawn: slots are not packed.
    expect(mesh.count).toBe(5)
    mesh.setMatrixAt(8, here)
    drawOnlyLive(mesh)
    expect(mesh.count).toBe(9)
    for (let k = 0; k < 10; k += 1) mesh.setMatrixAt(k, gone)
    drawOnlyLive(mesh)
    expect(mesh.count).toBe(0)
    // A shrinking instance, scaled small but not nought, is still live.
    mesh.setMatrixAt(9, new THREE.Matrix4().makeScale(1e-6, 1e-6, 1e-6))
    drawOnlyLive(mesh)
    expect(mesh.count).toBe(10)
  })
})

describe('liveInstanceCount', () => {
  it('counts to the last slot whose flag is set, holes included', () => {
    const live = new THREE.InstancedBufferAttribute(new Float32Array(6 * 4), 4)
    expect(liveInstanceCount(live, 3)).toBe(0)
    live.array[1 * 4 + 3] = 1
    live.array[3 * 4 + 3] = 0.5
    // Another component set does not make a slot live.
    live.array[5 * 4 + 2] = 1
    expect(liveInstanceCount(live, 3)).toBe(4)
    expect(liveInstanceCount(live, 2)).toBe(6)
  })
})
