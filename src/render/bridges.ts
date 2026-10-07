import * as THREE from 'three'
import { weather } from './weathered'

/** A bridge's deck: how wide, how thick, and the parapets' height, in radii. */
const WIDTH = 0.00034
const THICK = 0.00006
const PARAPET = 0.00005
/** How far apart the piers stand under a long bridge, in radians. */
const PIER_EVERY = 0.0012

/**
 * Bridges where the roads cross water (generation/settlements.ts, `bridges`;
 * their banks' ground found in the build worker): a stone deck from bank to
 * bank, rising in a shallow arch over the middle so it clears the water,
 * with low parapets either side and piers down into the river under a long
 * one. Built once, a child of the ground, a few boxes each.
 */
export class Bridges {
  readonly group = new THREE.Group()

  /** `placed` eight numbers a bridge: each bank's direction and its ground's radius. */
  constructor(placed: Float32Array) {
    const pieces: THREE.Matrix4[] = []
    const piers: THREE.Matrix4[] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const p = new THREE.Vector3()
    const q = new THREE.Vector3()
    const up = new THREE.Vector3()
    const along = new THREE.Vector3()
    const side = new THREE.Vector3()
    const basis = new THREE.Matrix4()
    const turn = new THREE.Quaternion()
    for (let k = 0; k + 7 < placed.length; k += 8) {
      a.set(placed[k] ?? 0, placed[k + 1] ?? 0, placed[k + 2] ?? 1)
      b.set(placed[k + 4] ?? 0, placed[k + 5] ?? 0, placed[k + 6] ?? 1)
      const ra = placed[k + 3] ?? 1
      const rb = placed[k + 7] ?? 1
      const span = a.angleTo(b)
      // Arched over the middle, enough to clear the water whatever the
      // banks' heights: a river is cut below both.
      const rise = 0.00025 + span * 0.06
      const deck = (t: number, into: THREE.Vector3): THREE.Vector3 => {
        const r = ra + (rb - ra) * t + rise * Math.sin(Math.PI * t) + THICK
        return into.copy(a).lerp(b, t).normalize().multiplyScalar(r)
      }
      const segments = Math.max(4, Math.ceil(span / 0.0003))
      for (let s = 0; s < segments; s += 1) {
        deck(s / segments, p)
        deck((s + 1) / segments, q)
        up.copy(p).add(q).normalize()
        along.copy(q).sub(p)
        const length = along.length()
        along.normalize()
        side.crossVectors(up, along).normalize()
        up.crossVectors(along, side).normalize()
        basis.makeBasis(side, up, along)
        turn.setFromRotationMatrix(basis)
        const middle = p.clone().add(q).multiplyScalar(0.5)
        // The deck, a little longer than its stretch so the joints close.
        pieces.push(
          new THREE.Matrix4().compose(
            middle.clone().addScaledVector(up, -THICK),
            turn,
            new THREE.Vector3(WIDTH, THICK, length * 1.04),
          ),
        )
        // The parapets.
        for (const way of [-1, 1])
          pieces.push(
            new THREE.Matrix4().compose(
              middle.clone().addScaledVector(side, (way * WIDTH) / 2),
              turn,
              new THREE.Vector3(0.00004, PARAPET, length * 1.04),
            ),
          )
      }
      // Piers under a long bridge, standing down into the river.
      const count = Math.floor(span / PIER_EVERY)
      for (let s = 1; s <= count; s += 1) {
        const t = s / (count + 1)
        deck(t, p)
        up.copy(p).normalize()
        const drop = p.length() - Math.min(ra, rb) + 0.001
        turn.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
        piers.push(
          new THREE.Matrix4().compose(
            // From its foot: the box stands up from its base, and placed by
            // its middle a pier stood half its height through the deck.
            p.clone().addScaledVector(up, -THICK - drop),
            turn,
            new THREE.Vector3(WIDTH * 0.7, drop, WIDTH * 0.45),
          ),
        )
      }
    }
    const stone = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.62, 0.58, 0.52),
      roughness: 0.9,
    })
    // Old stone, as the ruins' (weathered.ts): not cut true, mossed on top.
    weather(stone, {
      rough: 0.04,
      mottle: 0.3,
      grain: 14000,
      top: { colour: [0.3, 0.38, 0.18], amount: 0.4 },
      foot: { dark: 0.25, height: 0.2 },
      own: 0.2,
    })
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    for (const list of [pieces, piers]) {
      if (list.length === 0) continue
      const mesh = new THREE.InstancedMesh(box, stone, list.length)
      list.forEach((matrix, k) => {
        mesh.setMatrixAt(k, matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
  }
}
