import { parseAtlas, type AtlasEntry } from '@/app/atlas'
import { logger } from '@/shared/logger'

/**
 * Where the atlas lives: this browser's own storage, nowhere else — no
 * account, nothing sent. The one file allowed to touch `localStorage`
 * (a lint rule says so), so what is kept and how it is read stay in one
 * place. Reading is total (`parseAtlas`); a store that is full, blocked or
 * private reads as empty and writes nothing, rather than breaking the app.
 */
const KEY = 'planet-generator.atlas.v1'

export function loadAtlas(): readonly AtlasEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw === null ? [] : parseAtlas(JSON.parse(raw))
  } catch {
    logger.warn('atlas.unreadable')
    return []
  }
}

export function saveAtlas(atlas: readonly AtlasEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(atlas))
  } catch {
    // Full, most likely, with pictures: keep the worlds, drop the oldest
    // pictures, and try once more.
    try {
      const lighter = atlas.map((entry, k) => {
        if (k < 8 || entry.kept || entry.picture === undefined) return entry
        const lighter: AtlasEntry = {
          seed: entry.seed,
          name: entry.name,
          kind: entry.kind,
          dials: entry.dials,
          visitedAt: entry.visitedAt,
          kept: entry.kept,
          home: entry.home,
        }
        return lighter
      })
      window.localStorage.setItem(KEY, JSON.stringify(lighter))
    } catch {
      logger.warn('atlas.unwritable')
    }
  }
}
