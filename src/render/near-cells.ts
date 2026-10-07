import { neighboursOf } from '@/generation/hydrology'

/**
 * Things kept to the cells round the eye: a flock of birds, a school of
 * fish. Each cell of the drainage map has one or none, decided by `find`
 * and remembered; those of two rings of cells round the eye's cell are
 * held in a fixed number of slots, each keeping the slot it had while it
 * stays near, so nothing already drawn moves to another slot and pops.
 * The drawing fades things out well inside the rings' reach, so one
 * joining or leaving is never seen to.
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
    const wanted = new Set<number>([cell])
    for (const next of neighboursOf(cell)) {
      wanted.add(next)
      for (const further of neighboursOf(next)) wanted.add(further)
    }
    const present = new Set<number>()
    for (const k of wanted) if (this.thingIn(k) !== undefined) present.add(k)
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
