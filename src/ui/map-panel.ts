import type { Vec3 } from '@/generation/cube'
import { mapDirection, mapPoint, type WorldMap } from '@/generation/world-map'

/**
 * The map sheet: the world laid flat (generation/world-map.ts), with its
 * towns marked, faint lines every thirty degrees, and where the eye is —
 * an arrow the way it looks when flying, a ring when in orbit — kept up
 * to date while the sheet is open. A press anywhere on the map flies
 * there. The frame is in index.html; the map is drawn here when it comes.
 */
export interface MapHandlers {
  /** Fly to this point of the planet, a unit direction in its own frame. */
  readonly onGo: (direction: Vec3) => void
}

export interface Eye {
  readonly under: Vec3
  /** Which way it looks, or absent in orbit. */
  readonly facing: Vec3 | undefined
}

export interface MapPanel {
  /** Open on a world; `map` is a promise of its map, `eye` asked for each frame while open. */
  readonly show: (name: string, map: Promise<WorldMap>, eye: () => Eye) => void
  readonly hide: () => void
  readonly isOpen: () => boolean
}

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`index.html is missing #${id}`)
  return found
}

export function attachMap(handlers: MapHandlers): MapPanel {
  const sheet = element('map', HTMLElement)
  const title = element('map-title', HTMLElement)
  const canvas = element('map-canvas', HTMLCanvasElement)
  const marker = element('map-marker', HTMLElement)
  const waiting = element('map-waiting', HTMLElement)
  const scroll = element('map-scroll', HTMLElement)
  let open = false
  let shown = 0
  let frame: number | undefined
  let eyeOf: (() => Eye) | undefined

  const follow = (): void => {
    frame = undefined
    if (!open || eyeOf === undefined) return
    const { under, facing } = eyeOf()
    const [across, down] = mapPoint(under)
    marker.style.left = `${(across * 100).toFixed(3)}%`
    marker.style.top = `${(down * 100).toFixed(3)}%`
    marker.dataset.flying = String(facing !== undefined)
    if (facing !== undefined) {
      marker.style.setProperty('--bearing', `${bearingOf(under, facing).toFixed(1)}deg`)
    }
    frame = requestAnimationFrame(follow)
  }

  const close = (): void => {
    sheet.hidden = true
    open = false
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }
  element('map-close', HTMLButtonElement).addEventListener('click', close)

  canvas.addEventListener('click', (event) => {
    if (!waiting.hidden) return
    const box = canvas.getBoundingClientRect()
    const across = (event.clientX - box.left) / box.width
    const down = (event.clientY - box.top) / box.height
    if (across < 0 || across > 1 || down < 0 || down > 1) return
    close()
    handlers.onGo(mapDirection(across, down))
  })

  return {
    show: (name, map, eye) => {
      shown += 1
      const asked = shown
      title.textContent = name
      eyeOf = eye
      sheet.hidden = false
      open = true
      waiting.hidden = false
      marker.hidden = true
      void map.then((drawn) => {
        // A map that arrives after the sheet moved on to another world is not this one's.
        if (asked !== shown) return
        draw(canvas, drawn)
        waiting.hidden = true
        marker.hidden = false
        // Where the map is wider than the screen (a phone), open on the eye.
        const [across] = mapPoint(eye().under)
        scroll.scrollLeft = across * scroll.scrollWidth - scroll.clientWidth / 2
      })
      if (frame === undefined) frame = requestAnimationFrame(follow)
    },
    hide: close,
    isOpen: () => open,
  }
}

/** Paint the map, its graticule and its towns onto the canvas. */
function draw(canvas: HTMLCanvasElement, map: WorldMap): void {
  const width = map.width
  const height = map.pixels.length / 4 / width
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return
  context.putImageData(new ImageData(new Uint8ClampedArray(map.pixels), width, height), 0, 0)
  // Every thirty degrees, faint: enough to read a latitude by.
  context.strokeStyle = 'rgba(255, 255, 255, 0.13)'
  context.lineWidth = 1
  for (let k = 1; k < 6; k += 1) {
    const y = Math.round((k / 6) * height) + 0.5
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }
  for (let k = 1; k < 12; k += 1) {
    const x = Math.round((k / 12) * width) + 0.5
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }
  // Towns: a warm square each, larger for the larger, edged dark so it reads on any ground.
  for (let k = 0; k < map.towns.length; k += 3) {
    const x = Math.round((map.towns[k] ?? 0) * width)
    const y = Math.round((map.towns[k + 1] ?? 0) * height)
    const size = (map.towns[k + 2] ?? 0) > 0.5 ? 2 : 1
    context.fillStyle = 'rgba(20, 14, 8, 0.8)'
    context.fillRect(x - size, y - size, size * 2 + 1, size * 2 + 1)
    context.fillStyle = '#ffcf7a'
    context.fillRect(x - size + 1, y - size + 1, size * 2 - 1, size * 2 - 1)
  }
}

/** Degrees east of north that `facing` points, along the ground at `under`. */
export function bearingOf(under: Vec3, facing: Vec3): number {
  const [x, y, z] = under
  // East along the ground: square to the axis and the point; north square to both.
  let east: Vec3 = [z, 0, -x]
  const length = Math.hypot(east[0], east[2]) || 1
  east = [east[0] / length, 0, east[2] / length]
  const north: Vec3 = [
    y * east[2] - z * east[1],
    z * east[0] - x * east[2],
    x * east[1] - y * east[0],
  ]
  const e = facing[0] * east[0] + facing[1] * east[1] + facing[2] * east[2]
  const n = facing[0] * north[0] + facing[1] * north[1] + facing[2] * north[2]
  return (Math.atan2(e, n) * 180) / Math.PI
}
