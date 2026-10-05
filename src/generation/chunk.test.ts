import { describe, expect, it } from 'vitest'

import { at, blockId, blockOf, CHUNK, chunkBlocks, meshChunk, SOLID, type Palette } from './chunk'
import { directionOn } from './cube'
import { createPlanet, surfaceAt, type Planet } from './planet'
import { parseSeed, type Seed } from './seed'
import { AREA, HEIGHT, landingAt } from './voxel'

const seedOf = (text: string): Seed => {
  const parsed = parseSeed(text)
  if (parsed === undefined) throw new Error('test seed must parse')
  return parsed
}
const planet = createPlanet(seedOf('2257afq'))
const palette: Palette = {
  lush: [0.1, 0.4, 0.1],
  dry: [0.5, 0.5, 0.2],
  highland: [0.4, 0.35, 0.3],
  peak: [0.6, 0.6, 0.6],
  ice: [0.9, 0.95, 1],
  shallow: [0.1, 0.5, 0.6],
}

function spotWhere(
  world: Planet,
  wanted: (s: ReturnType<typeof surfaceAt>) => boolean,
): [number, number, number] {
  for (let step = 0; step < 4000; step += 1) {
    const d = directionOn(4, (step % 63) / 31 - 1, Math.floor(step / 63) / 31 - 1)
    if (wanted(surfaceAt(world, d[0], d[1], d[2]))) return [d[0], d[1], d[2]]
  }
  throw new Error('no such spot')
}

describe('a chunk', () => {
  const land = landingAt(
    planet,
    spotWhere(planet, (s) => s.biome === 'land' && s.height > 0.08),
  )
  const middle = AREA / CHUNK / 2
  const blocks = chunkBlocks(land, middle, middle)
  const mesh = meshChunk(blocks, palette)

  it('holds the full column with a one-block halo, solid below the ground and air above', () => {
    expect(blocks.length).toBe((CHUNK + 2) * (CHUNK + 2) * HEIGHT)
    expect(blockOf(blocks[at(0, 0, 0)] ?? 0)).toBe('stone')
    expect(blockOf(blocks[at(-1, 0, -1)] ?? 0)).toBe('stone')
    expect(blockOf(blocks[at(8, HEIGHT - 1, 8)] ?? 0)).toBe('air')
  })

  it('meshes only faces that can be seen, well-formed', () => {
    const count = mesh.positions.length / 3
    expect(count).toBeGreaterThan(CHUNK * CHUNK * 4)
    expect(mesh.normals.length).toBe(count * 3)
    expect(mesh.colours.length).toBe(count * 3)
    expect(mesh.tiles.length).toBe(count)
    expect(mesh.uvs.length).toBe(count * 2)
    expect(mesh.index.length % 3).toBe(0)
    for (const i of mesh.index) expect(i).toBeLessThan(count)
    for (let v = 0; v < count; v += 1) {
      expect(mesh.positions[v * 3]).toBeGreaterThanOrEqual(0)
      expect(mesh.positions[v * 3]).toBeLessThanOrEqual(CHUNK)
      expect(mesh.positions[v * 3 + 1]).toBeGreaterThanOrEqual(0)
      expect(mesh.positions[v * 3 + 1]).toBeLessThanOrEqual(HEIGHT)
    }
    // Far fewer faces than blocks: a solid column costs its top, not its depth.
    const solids = [...blocks].filter((id) => SOLID.has(blockOf(id))).length
    expect(mesh.index.length / 6).toBeLessThan(solids / 10)
  })

  it('lays an edit over the ground', () => {
    const key = (x: number, y: number, z: number): number => x * 1000000 + y * 1000 + z
    const x = middle * CHUNK + 4
    const z = middle * CHUNK + 4
    // Find the top of that column, then take it away.
    let top = 0
    for (let y = HEIGHT - 1; y >= 0; y -= 1) {
      if (SOLID.has(blockOf(blocks[at(4, y, 4)] ?? 0))) {
        top = y
        break
      }
    }
    const edited = chunkBlocks(land, middle, middle, new Map([[key(x, top, z), 'air']]), key)
    expect(blockOf(edited[at(4, top, 4)] ?? 0)).toBe('air')
    expect(blockOf(edited[at(4, top - 1, 4)] ?? 0)).not.toBe('air')
  })

  it('draws the sea as a fluid surface', () => {
    const sea = landingAt(
      planet,
      spotWhere(planet, (s) => s.height < -0.08),
    )
    const wet = meshChunk(chunkBlocks(sea, middle, middle), palette)
    expect(wet.fluid.positions.length).toBeGreaterThan(0)
    // The surface lies just under the top of the sea-level block.
    let highest = 0
    for (let v = 0; v < wet.fluid.positions.length / 3; v += 1) {
      highest = Math.max(highest, wet.fluid.positions[v * 3 + 1] ?? 0)
    }
    expect(highest).toBeCloseTo(sea.seaRow + 0.88, 4)
    expect(blockId('water')).toBe(1)
  })
})
