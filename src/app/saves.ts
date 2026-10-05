import { MODULES, type Module, type Ship } from '@/generation/expedition'
import type { Block } from '@/generation/voxel'
import { logger } from '@/shared/logger'

/**
 * What the surveyor did, kept on the device: the blocks changed at each
 * landing plot of each world, and what is in the ship's hold — one hold,
 * because the ship carries it from world to world. The world itself is
 * never stored — the seed makes it — so a save is only ever a diff.
 *
 * IndexedDB, behind two small functions, so nothing else in the app knows
 * what a database is. A save that cannot be read (a private window, a full
 * disk) degrades to an empty one with a warning: digging still works, it
 * just does not last.
 */
const DATABASE = 'planet-generator'
const STORE = 'saves'

export interface PlotSave {
  /** [block key, block] pairs; see voxel.ts `blockKey`. */
  readonly edits: readonly (readonly [number, Block])[]
}

export interface Hold {
  readonly counts: Readonly<Partial<Record<Block, number>>>
}

function open(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => {
        resolve(request.result)
      }
      request.onerror = () => {
        logger.warn('saves.unavailable', { reason: request.error?.name ?? 'unknown' })
        resolve(undefined)
      }
    } catch (error) {
      logger.warn('saves.unavailable', { reason: error instanceof Error ? error.name : 'unknown' })
      resolve(undefined)
    }
  })
}

async function read(key: string): Promise<unknown> {
  const db = await open()
  if (db === undefined) return undefined
  return new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    request.onsuccess = () => {
      resolve(request.result)
      db.close()
    }
    request.onerror = () => {
      resolve(undefined)
      db.close()
    }
  })
}

async function write(key: string, value: unknown): Promise<void> {
  const db = await open()
  if (db === undefined) return
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(value, key)
    transaction.oncomplete = () => {
      resolve()
      db.close()
    }
    transaction.onerror = () => {
      logger.warn('saves.write-failed', { reason: transaction.error?.name ?? 'unknown' })
      resolve()
      db.close()
    }
  })
}

/** The edits at a landing plot of a world, or none. Read as `unknown` and checked. */
export async function loadPlot(seed: string, plot: string): Promise<PlotSave> {
  const raw = await read(`plot:${seed}:${plot}`)
  if (typeof raw !== 'object' || raw === null) return { edits: [] }
  const edits: unknown = (raw as { edits?: unknown }).edits
  if (!Array.isArray(edits)) return { edits: [] }
  const kept: (readonly [number, Block])[] = []
  for (const entry of edits as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [key, block] = entry as [unknown, unknown]
    if (typeof key === 'number' && typeof block === 'string') kept.push([key, block as Block])
  }
  return { edits: kept }
}

export function savePlot(seed: string, plot: string, save: PlotSave): Promise<void> {
  return write(`plot:${seed}:${plot}`, { edits: save.edits })
}

export async function loadHold(): Promise<Hold> {
  const raw = await read('hold')
  if (typeof raw !== 'object' || raw === null) return { counts: {} }
  const counts: unknown = (raw as { counts?: unknown }).counts
  if (typeof counts !== 'object' || counts === null) return { counts: {} }
  const kept: Partial<Record<Block, number>> = {}
  for (const [block, count] of Object.entries(counts as Record<string, unknown>)) {
    if (typeof count === 'number' && count > 0) kept[block as Block] = Math.floor(count)
  }
  return { counts: kept }
}

export function saveHold(hold: Hold): Promise<void> {
  return write('hold', { counts: hold.counts })
}

/** The ship, which outlives any one world; absent until an expedition starts. */
export async function loadShip(): Promise<Ship | undefined> {
  const raw = await read('ship')
  if (typeof raw !== 'object' || raw === null) return undefined
  const { modules, fuel, expedition, jumps } = raw as {
    modules?: unknown
    fuel?: unknown
    expedition?: unknown
    jumps?: unknown
  }
  if (typeof fuel !== 'number' || typeof expedition !== 'string' || typeof jumps !== 'number')
    return undefined
  const kept: Module[] = []
  if (Array.isArray(modules)) {
    for (const module of modules as unknown[]) {
      if (typeof module === 'string' && (MODULES as readonly string[]).includes(module))
        kept.push(module as Module)
    }
  }
  return {
    modules: kept,
    fuel: Math.max(0, Math.floor(fuel)),
    expedition,
    jumps: Math.floor(jumps),
  }
}

export function saveShip(ship: Ship): Promise<void> {
  return write('ship', { ...ship, modules: [...ship.modules] })
}

/** One finished expedition, for the logbook. */
export interface LogEntry {
  readonly expedition: string
  readonly worlds: number
  readonly modules: number
  readonly endedAt: number
}

export async function loadLogbook(): Promise<LogEntry[]> {
  const raw = await read('logbook')
  if (!Array.isArray(raw)) return []
  const kept: LogEntry[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { expedition, worlds, modules, endedAt } = entry as Record<string, unknown>
    if (
      typeof expedition === 'string' &&
      typeof worlds === 'number' &&
      typeof modules === 'number' &&
      typeof endedAt === 'number'
    )
      kept.push({ expedition, worlds, modules, endedAt })
  }
  return kept
}

export function saveLogbook(entries: readonly LogEntry[]): Promise<void> {
  return write('logbook', entries)
}
