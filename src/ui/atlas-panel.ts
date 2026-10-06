import { shelves, type AtlasEntry } from '@/app/atlas'
import type { Seed } from '@/generation/seed'

/**
 * The atlas sheet: the worlds kept, then the worlds visited, each a card
 * with its picture from orbit, its name and its kind. A press opens the
 * world; the star keeps it or lets it go. The markup's frame is in
 * index.html; the cards are built here from the atlas each time it opens.
 */
export interface AtlasHandlers {
  readonly onOpen: (entry: AtlasEntry) => void
  readonly onKeep: (seed: Seed, kept: boolean) => void
}

export interface AtlasPanel {
  readonly show: (atlas: readonly AtlasEntry[], current: Seed | undefined) => void
  readonly hide: () => void
  readonly isOpen: () => boolean
}

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`index.html is missing #${id}`)
  return found
}

export function attachAtlas(handlers: AtlasHandlers): AtlasPanel {
  const sheet = element('atlas', HTMLElement)
  const keptList = element('atlas-kept', HTMLElement)
  const recentList = element('atlas-recent', HTMLElement)
  const keptHeading = element('atlas-kept-heading', HTMLElement)
  const empty = element('atlas-empty', HTMLElement)
  let open = false
  let last: { atlas: readonly AtlasEntry[]; current: Seed | undefined } = {
    atlas: [],
    current: undefined,
  }

  const card = (entry: AtlasEntry, current: boolean): HTMLElement => {
    const item = document.createElement('li')
    item.className = 'atlas-card'
    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'atlas-open'
    go.setAttribute('aria-label', `Open ${entry.name}${current ? ', the world on screen' : ''}`)
    const picture = document.createElement('span')
    picture.className = 'atlas-picture'
    if (entry.picture !== undefined) picture.style.backgroundImage = `url(${entry.picture})`
    const words = document.createElement('span')
    words.className = 'atlas-words'
    const name = document.createElement('strong')
    name.textContent = entry.name
    const kind = document.createElement('span')
    kind.textContent = current ? `${entry.kind} · here now` : entry.kind
    words.append(name, kind)
    go.append(picture, words)
    go.addEventListener('click', () => {
      handlers.onOpen(entry)
    })
    const star = document.createElement('button')
    star.type = 'button'
    star.className = 'atlas-star'
    star.setAttribute('aria-pressed', String(entry.kept))
    star.setAttribute('aria-label', entry.kept ? `Let ${entry.name} go` : `Keep ${entry.name}`)
    star.textContent = entry.kept ? '★' : '☆'
    star.addEventListener('click', () => {
      handlers.onKeep(entry.seed, !entry.kept)
    })
    item.append(go, star)
    return item
  }

  const render = (): void => {
    const { kept, recent } = shelves(last.atlas)
    keptList.replaceChildren(...kept.map((e) => card(e, e.seed === last.current)))
    recentList.replaceChildren(...recent.map((e) => card(e, e.seed === last.current)))
    keptHeading.hidden = kept.length === 0
    keptList.hidden = kept.length === 0
    empty.hidden = last.atlas.length > 0
  }

  element('atlas-close', HTMLButtonElement).addEventListener('click', () => {
    sheet.hidden = true
    open = false
  })

  return {
    show: (atlas, current) => {
      last = { atlas, current }
      render()
      sheet.hidden = false
      open = true
    },
    hide: () => {
      sheet.hidden = true
      open = false
    },
    isOpen: () => open,
  }
}

/** A square picture of the middle of a view, small enough to keep many of. */
export async function pictureOf(view: Blob, size = 160): Promise<string | undefined> {
  const bitmap = await createImageBitmap(view)
  const side = Math.min(bitmap.width, bitmap.height) * 0.86
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) return undefined
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  )
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.78)
}
