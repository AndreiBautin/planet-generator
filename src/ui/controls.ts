import type { Clock } from '@/app/clock'

/**
 * Pointer events in, gestures out. One finger or the mouse drags; two
 * fingers pinch; the wheel scrolls. Pointer Events rather than touch and
 * mouse separately, so a pen, a finger and a trackpad all take the same
 * path.
 *
 * What a gesture does is not decided here: the same drag turns the orbit or
 * steers a glide depending on what the camera is doing, and that is the
 * caller's to know.
 */
export interface GestureHandlers {
  /** A finger landed. */
  readonly grab: () => void
  /** A finger moved by (dx, dy) pixels over `seconds`, on a target `height` pixels tall. */
  readonly drag: (dx: number, dy: number, seconds: number, height: number) => void
  /** The last finger lifted, `sinceMove` seconds after it last moved. */
  readonly release: (sinceMove: number) => void
  /** Two fingers spread by `factor` (new gap over old). */
  readonly pinch: (factor: number) => void
  readonly wheel: (deltaY: number) => void
}

interface Point {
  readonly x: number
  readonly y: number
}

export function attachGestures(
  target: HTMLElement,
  clock: Clock,
  handlers: GestureHandlers,
): () => void {
  let lastMoveAt = clock.now()
  const pointers = new Map<number, Point>()

  const gap = (): number => {
    const [a, b] = [...pointers.values()]
    return a !== undefined && b !== undefined ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const down = (event: PointerEvent): void => {
    target.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    handlers.grab()
    lastMoveAt = clock.now()
  }

  const move = (event: PointerEvent): void => {
    const before = pointers.get(event.pointerId)
    if (before === undefined) return
    const now = clock.now()
    if (pointers.size >= 2) {
      const was = gap()
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const is = gap()
      if (was > 0) handlers.pinch(is / was)
    } else {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      handlers.drag(
        event.clientX - before.x,
        event.clientY - before.y,
        (now - lastMoveAt) / 1000,
        target.clientHeight,
      )
    }
    lastMoveAt = now
  }

  const up = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return
    // Lifting one finger of a pinch leaves the other holding on; only the
    // last finger lets go.
    if (pointers.size === 0) handlers.release((clock.now() - lastMoveAt) / 1000)
    else handlers.grab()
  }

  const scroll = (event: WheelEvent): void => {
    event.preventDefault()
    handlers.wheel(event.deltaY)
  }

  target.addEventListener('pointerdown', down)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
  target.addEventListener('wheel', scroll, { passive: false })

  return () => {
    target.removeEventListener('pointerdown', down)
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', up)
    target.removeEventListener('wheel', scroll)
  }
}
