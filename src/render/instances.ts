import type * as THREE from 'three'

/**
 * Draw an instanced mesh only up to its last live instance. The near-the-eye
 * features keep a slot for everything they might hold and park the empty
 * ones at a scale of nought — which the GPU still draws, every triangle of
 * them: in a village 640 herd instances were drawn with none alive, and
 * empty slots were most of the triangles every model on the ground cost.
 * Live means any scale at all; the slots past the last live one are not
 * drawn, those before it still are (the slots are not packed, so that
 * nothing moves between slots and pops).
 */
export function drawOnlyLive(mesh: THREE.InstancedMesh): void {
  const stored: unknown = mesh.userData.capacity
  const capacity = typeof stored === 'number' ? stored : mesh.count
  mesh.userData.capacity = capacity
  const matrices = mesh.instanceMatrix.array
  let last = -1
  for (let k = capacity - 1; k >= 0; k -= 1) {
    const at = k * 16
    // A parked instance is the zero matrix's scale: its first three columns nought.
    if (
      matrices[at] !== 0 ||
      matrices[at + 1] !== 0 ||
      matrices[at + 2] !== 0 ||
      matrices[at + 5] !== 0 ||
      matrices[at + 10] !== 0
    ) {
      last = k
      break
    }
  }
  mesh.count = last + 1
}
