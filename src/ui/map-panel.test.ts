import { describe, expect, it } from 'vitest'
import { mapPoint } from '@/generation/world-map'
import { placeLabel } from './map-panel'

describe('placeLabel', () => {
  it('reads the middle of the map as the planet’s +z, on the equator', () => {
    expect(placeLabel(0.5, 0.5)).toBe('0.0° N · 0.0° E')
  })

  it('agrees with the map’s own projection about which way is north and east', () => {
    // A point up and towards +x lies north and east on the map.
    const [across, down] = mapPoint([0.5, 0.5, 0.7])
    expect(placeLabel(across, down)).toMatch(/° N · .*° E$/)
    expect(placeLabel(0, 1)).toBe('90.0° S · 180.0° W')
  })
})
