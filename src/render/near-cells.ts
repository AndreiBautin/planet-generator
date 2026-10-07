import { cellCentre, neighboursOf } from '@/generation/hydrology'

/**
 * How many rings of cells round the eye's are held. Two were thought to
 * reach two cells (0.0245) every way; measured, they reached only 0.0175
 * near the edges of the cube's faces, where a step of one cell across the
 * seam goes less far — inside where most things here fade out, so a
 * flock or a balloon could appear part-grown there. Three reach just short
 * of 0.0265 at the worst (measured over 3,200 eyes, scattered and crowded at the
 * cube's corners and edges), outside every fade in use.
 */
export const RINGS = 3
/** What the rings reach at the least, in radians: everything drawn must have faded by here. */
export const HELD_REACH = 0.026

/**
 * Things kept to the cells round the eye: a flock of birds, a school of
 * fish. Each cell of the drainage map has one or none, decided by `find`
 * and remembered; those of `RINGS` rings of cells round the eye's cell
 * are held in a fixed number of slots, each keeping the slot it had while
 * it stays near, so nothing already drawn moves to another slot and pops.
 * The drawing fades things out inside `HELD_REACH`, so one joining or
 * leaving is never seen to.
 */
export class NearCells<T> {
  private readonly slots: (number | undefined)[]
  private readonly known = new Map<number, T | undefined>()
  private cell = -1
  private readonly find: (cell: number) => T | undefined
  private readonly fill: (slot: number, cell: number, thing: T) => void
  private readonly clear: (slot: number) => void

  constructor(
    slots: number,
    find: (cell: number) => T | undefined,
    fill: (slot: number, cell: number, thing: T) => void,
    clear: (slot: number) => void,
  ) {
    this.slots = new Array<number | undefined>(slots)
    this.find = find
    this.fill = fill
    this.clear = clear
  }

  /** Forget everything: a new world. */
  reset(): void {
    this.known.clear()
    this.slots.fill(undefined)
    this.cell = -1
  }

  /** Gather round `cell` if the eye has moved into it; says whether anything changed. */
  near(cell: number): boolean {
    if (cell === this.cell) return false
    this.cell = cell
    let wanted = new Set<number>([cell])
    for (let ring = 0; ring < RINGS; ring += 1) {
      const next = new Set(wanted)
      for (const k of wanted) for (const n of neighboursOf(k)) next.add(n)
      wanted = next
    }
    // Nearest first: were the slots ever short, it is the far cells, past
    // where anything is drawn, that go without.
    const [ex, ey, ez] = cellCentre(cell)
    const present = new Set<number>(
      [...wanted]
        .filter((k) => this.thingIn(k) !== undefined)
        .map((k) => {
          const [x, y, z] = cellCentre(k)
          return { k, near: x * ex + y * ey + z * ez }
        })
        .sort((a, b) => b.near - a.near)
        .map(({ k }) => k),
    )
    // Free the slots of things no longer near; keep the rest where they are.
    this.slots.forEach((held, slot) => {
      if (held !== undefined && !present.has(held)) {
        this.slots[slot] = undefined
        this.clear(slot)
      }
    })
    for (const k of present) {
      if (this.slots.includes(k)) continue
      const free = this.slots.indexOf(undefined)
      if (free < 0) break
      const thing = this.thingIn(k)
      if (thing === undefined) continue
      this.slots[free] = k
      this.fill(free, k, thing)
    }
    return true
  }

  private thingIn(cell: number): T | undefined {
    if (!this.known.has(cell)) this.known.set(cell, this.find(cell))
    return this.known.get(cell)
  }
}
