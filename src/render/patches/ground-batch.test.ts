import { describe, expect, it } from 'vitest'

import { batchLayout, wholeIndex } from './ground-batch'

describe('batchLayout', () => {
  const segments = 8
  const layout = batchLayout(segments)

  it('draws the same triangles as the whole patch, through its copies', () => {
    const key = (a: number, b: number, c: number): string =>
      [a, b, c].sort((x, y) => x - y).join(',')
    const made: string[] = []
    for (let k = 0; k < layout.index.length; k += 3) {
      const at = (n: number): number => layout.source[layout.index[k + n] ?? 0] ?? -1
      made.push(key(at(0), at(1), at(2)))
    }
    const whole = wholeIndex(segments)
    const wanted: string[] = []
    for (let k = 0; k < whole.length; k += 3)
      wanted.push(key(whole[k] ?? 0, whole[k + 1] ?? 0, whole[k + 2] ?? 0))
    expect(made.sort()).toEqual(wanted.sort())
  })

  it('puts every triangle wholly in one quarter, so hiding a quarter hides whole triangles', () => {
    const quarter = (v: number): number => layout.cell[v * 4] ?? -1
    for (let k = 0; k < layout.index.length; k += 3) {
      const q = quarter(layout.index[k] ?? 0)
      expect(quarter(layout.index[k + 1] ?? 0)).toBe(q)
      expect(quarter(layout.index[k + 2] ?? 0)).toBe(q)
    }
  })

  it('knows each grid vertex by its column and row, and each skirt vertex by its edge', () => {
    const side = segments + 1
    layout.source.forEach((from, v) => {
      const [, i, j, skirt] = [...layout.cell.slice(v * 4, v * 4 + 4)]
      if (from < side * side) {
        expect(skirt).toBe(-1)
        expect((j ?? 0) * side + (i ?? 0)).toBe(from)
      } else expect(skirt).toBe(Math.floor((from - side * side) / side))
    })
  })
})
