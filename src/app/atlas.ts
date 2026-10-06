import { DEFAULT_DIALS, type Dials } from '@/generation/planet'
import { parseSeed, type Seed } from '@/generation/seed'

/**
 * The atlas: the worlds this browser has been to, and the ones kept. One
 * entry a seed — moving a dial on a world is still that world, so it
 * updates the entry rather than filing a new one for every notch — with
 * the dials it was last seen at, a small picture, and when.
 *
 * Pure: what to keep and in what order is decided here, and the store
 * (ui/atlas-store.ts) only reads and writes it. What comes back from
 * storage is read as `unknown` and parsed totally, since anything may be
 * in there: a garbled entry is dropped, never trusted.
 */
export interface AtlasEntry {
  readonly seed: Seed
  readonly name: string
  readonly kind: string
  readonly dials: Dials
  /** Clock time it was last open, in milliseconds. */
  readonly visitedAt: number
  /** Kept on purpose: never pushed out by newer visits. */
  readonly kept: boolean
  /** A small picture of it from orbit, as a data URL; absent until one is taken. */
  readonly picture?: string
  /** The home of its star system (generation/system.ts): itself unless reached from a sibling. */
  readonly home: Seed
}

/** How many worlds visited but not kept the atlas holds; the oldest go first. */
export const RECENT_LIMIT = 24

/** A visit: put the world first, keeping what is known of it, and let the oldest unkept go. */
export function visit(
  atlas: readonly AtlasEntry[],
  world: Pick<AtlasEntry, 'seed' | 'name' | 'kind' | 'dials' | 'home'>,
  at: number,
): readonly AtlasEntry[] {
  const known = atlas.find((entry) => entry.seed === world.seed)
  const entry: AtlasEntry = {
    ...(known ?? { kept: false }),
    seed: world.seed,
    name: world.name,
    kind: world.kind,
    dials: world.dials,
    home: world.home,
    visitedAt: at,
  }
  const others = atlas.filter((other) => other.seed !== world.seed)
  let recent = 0
  return [entry, ...others].filter((other) => {
    if (other.kept) return true
    recent += 1
    return recent <= RECENT_LIMIT
  })
}

/** Give a world its picture: a new picture replaces the old, since the dials may have moved. */
export function picture(
  atlas: readonly AtlasEntry[],
  seed: Seed,
  url: string,
): readonly AtlasEntry[] {
  return atlas.map((entry) => (entry.seed === seed ? { ...entry, picture: url } : entry))
}

/** Keep a world or let it go back among the recent ones. */
export function keep(
  atlas: readonly AtlasEntry[],
  seed: Seed,
  kept: boolean,
): readonly AtlasEntry[] {
  return atlas.map((entry) => (entry.seed === seed ? { ...entry, kept } : entry))
}

/** The kept worlds and the rest, each newest first. */
export function shelves(atlas: readonly AtlasEntry[]): {
  readonly kept: readonly AtlasEntry[]
  readonly recent: readonly AtlasEntry[]
} {
  const newest = [...atlas].sort((a, b) => b.visitedAt - a.visitedAt)
  return {
    kept: newest.filter((entry) => entry.kept),
    recent: newest.filter((entry) => !entry.kept),
  }
}

const number = (value: unknown, low: number, high: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
    ? value
    : fallback

function parseDials(raw: unknown): Dials {
  const d = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    water: number(d['water'], 0, 1, DEFAULT_DIALS.water),
    temperature: number(d['temperature'], -1, 1, DEFAULT_DIALS.temperature),
    roughness: number(d['roughness'], 0, 1, DEFAULT_DIALS.roughness),
    season: number(d['season'], 0, 1, DEFAULT_DIALS.season),
  }
}

function parseEntry(raw: unknown): AtlasEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const seed = parseSeed(typeof r['seed'] === 'string' ? r['seed'] : null)
  if (seed === undefined) return undefined
  const name = typeof r['name'] === 'string' ? r['name'].slice(0, 40) : seed
  const kind = typeof r['kind'] === 'string' ? r['kind'].slice(0, 20) : ''
  const picture =
    typeof r['picture'] === 'string' && r['picture'].startsWith('data:image/')
      ? r['picture']
      : undefined
  return {
    seed,
    name,
    kind,
    dials: parseDials(r['dials']),
    visitedAt: number(r['visitedAt'], 0, Number.MAX_SAFE_INTEGER, 0),
    kept: r['kept'] === true,
    // An entry written before systems were kept is its own system's home.
    home: parseSeed(typeof r['home'] === 'string' ? r['home'] : null) ?? seed,
    ...(picture === undefined ? {} : { picture }),
  }
}

/** Read an atlas back from storage: whatever is there, an atlas comes out, garbled entries left behind. */
export function parseAtlas(raw: unknown): readonly AtlasEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AtlasEntry[] = []
  for (const item of raw) {
    const entry = parseEntry(item)
    if (entry === undefined || seen.has(entry.seed)) continue
    seen.add(entry.seed)
    out.push(entry)
  }
  return out
}
