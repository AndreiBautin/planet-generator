import type { Clock } from '@/app/clock'

import { drag, grab, INITIAL_ORBIT, pinch, release, settle, wheel, type Orbit } from './orbit'

/**
 * Pointer events in, an `Orbit` out. One finger or the mouse turns the
 * camera; two fingers pinch; the wheel zooms. Pointer Events rather than
 * touch and mouse separately, so a pen, a finger and a trackpad all take
 * the same path.
 *
 * The orbit is settled lazily, when the frame loop asks for it, from the
 * clock — so a coast runs on elapsed time and never on a frame count.
 */
export interface OrbitControls {
  readonly current: () => Orbit
  readonly dispose: () => void
}

interface Point {
  readonly x: number
  readonly y: number
}

export function attachOrbit(target: HTMLElement, clock: Clock): OrbitControls {
  let orbit = INITIAL_ORBIT
  let settledAt = clock.now()
  let lastMoveAt = settledAt
  const pointers = new Map<number, Point>()

  const gap = (): number => {
    const [a, b] = [...pointers.values()]
    return a !== undefined && b !== undefined ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const down = (event: PointerEvent): void => {
    target.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    orbit = grab(orbit)
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
      if (was > 0) orbit = pinch(orbit, is / was)
    } else {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      orbit = drag(
        orbit,
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
    // Lifting one finger of a pinch leaves the other holding the planet;
    // only the last finger lets it coast.
    if (pointers.size === 0) orbit = release(orbit, (clock.now() - lastMoveAt) / 1000)
    else orbit = grab(orbit)
    settledAt = clock.now()
  }

  const scroll = (event: WheelEvent): void => {
    event.preventDefault()
    orbit = wheel(orbit, event.deltaY)
  }

  target.addEventListener('pointerdown', down)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
  target.addEventListener('wheel', scroll, { passive: false })

  return {
    current: () => {
      const now = clock.now()
      orbit = settle(orbit, (now - settledAt) / 1000)
      settledAt = now
      return orbit
    },
    dispose: () => {
      target.removeEventListener('pointerdown', down)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      target.removeEventListener('wheel', scroll)
    },
  }
}
