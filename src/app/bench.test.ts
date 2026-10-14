import { describe, expect, it } from 'vitest'
import { spread, summarise } from './bench'

describe('bench', () => {
  it('takes the median and p95 ignoring frames without a reading', () => {
    const values = [...Array.from({ length: 100 }, (_, i) => i + 1), Number.NaN]
    expect(spread(values)).toEqual({ median: 51, p95: 96 })
  })

  it('reports NaN, not nought, when nothing was measured', () => {
    // A machine without GPU timer queries must not read as a free GPU.
    const s = summarise([{ scriptMs: 2, gpuMs: Number.NaN, calls: 10, triangles: 5 }])
    expect(s.gpuMs.median).toBeNaN()
    expect(s.scriptMs.median).toBe(2)
  })
})
