import * as THREE from 'three'

/**
 * A group whose matrix update walks only its visible children. The terrain
 * holds every patch it has cached — about ten thousand objects over a
 * glide, a seventh of them shown — and three walks hidden children too,
 * twice a frame (the scene's update and the render's): 8 ms each on a
 * desktop. A child skipped while its parent moved is marked stale, so it
 * catches up the first frame it is shown again.
 */
export class VisibleGroup extends THREE.Group {
  override updateMatrixWorld(force?: boolean): void {
    if (this.matrixAutoUpdate) this.updateMatrix()
    let moved = force === true
    if (this.matrixWorldNeedsUpdate || moved) {
      if (this.matrixWorldAutoUpdate) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix)
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
      }
      this.matrixWorldNeedsUpdate = false
      moved = true
    }
    for (const child of this.children) {
      if (child.visible) child.updateMatrixWorld(moved)
      else if (moved) child.matrixWorldNeedsUpdate = true
    }
  }
}
