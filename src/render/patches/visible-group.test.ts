import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { VisibleGroup } from './visible-group'

describe('VisibleGroup', () => {
  it('skips a hidden child, and brings it up to date once shown even if the group has stopped', () => {
    const scene = new THREE.Scene()
    const group = new VisibleGroup()
    const child = new THREE.Mesh()
    child.position.set(1, 0, 0)
    group.add(child)
    scene.add(group)
    scene.updateMatrixWorld()
    child.visible = false
    group.rotation.y = Math.PI / 2
    scene.updateMatrixWorld()
    // Hidden while the group turned: not walked.
    expect(new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).x).toBeCloseTo(1)
    // The group now holds still; the child is shown and must still catch up.
    scene.updateMatrixWorld()
    child.visible = true
    scene.updateMatrixWorld()
    const at = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld)
    expect(at.x).toBeCloseTo(0)
    expect(at.z).toBeCloseTo(-1)
  })
})
