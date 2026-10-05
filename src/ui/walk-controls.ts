import type { Clock } from '@/app/clock'

import type { WalkInput } from './walker'

/**
 * How a finger or a keyboard walks the surveyor.
 *
 * On a touch screen the left half of the screen is a stick — press and
 * drag, and the drag from where the finger landed is the push — and the
 * right half looks, dragging the view the way the finger goes. A Jump
 * button sits above the actions. On a keyboard it is W A S D, Space to
 * jump, and the mouse drags the look.
 *
 * Installed in the capture phase and stopping the event while walking, so
 * the orbit and glide gestures on the same canvas never see a walking
 * finger; when not walking it touches nothing.
 */
const STICK_REACH = 56
const LOOK_PER_PIXEL = 0.0042

const TAP_MS = 260
const TAP_PIXELS = 9

export function attachWalkControls(
  target: HTMLElement,
  jump: HTMLElement,
  place: HTMLElement,
  clock: Clock,
  walking: () => boolean,
  send: (input: Partial<WalkInput>) => void,
  acts: { readonly dig: () => void; readonly build: () => void },
): () => void {
  interface Touch {
    readonly role: 'stick' | 'look'
    readonly x0: number
    readonly y0: number
    readonly at: number
    x: number
    y: number
    moved: boolean
  }
  const touches = new Map<number, Touch>()
  const keys = new Set<string>()

  const push = (): void => {
    let forward = 0
    let strafe = 0
    for (const touch of touches.values()) {
      if (touch.role !== 'stick') continue
      forward = Math.max(-1, Math.min(1, -(touch.y - touch.y0) / STICK_REACH))
      strafe = Math.max(-1, Math.min(1, (touch.x - touch.x0) / STICK_REACH))
    }
    if (keys.has('w') || keys.has('ArrowUp')) forward = 1
    if (keys.has('s') || keys.has('ArrowDown')) forward = -1
    if (keys.has('a') || keys.has('ArrowLeft')) strafe = -1
    if (keys.has('d') || keys.has('ArrowRight')) strafe = 1
    send({ forward, strafe })
  }

  const down = (event: PointerEvent): void => {
    if (!walking()) return
    event.stopImmediatePropagation()
    target.setPointerCapture(event.pointerId)
    // A mouse's right button builds; everything else is a look, a stick,
    // or — lifted quickly without moving — a tap that digs.
    if (event.pointerType === 'mouse' && event.button === 2) {
      acts.build()
      return
    }
    const role =
      event.pointerType === 'mouse' || event.clientX > window.innerWidth / 2 ? 'look' : 'stick'
    touches.set(event.pointerId, {
      role,
      x0: event.clientX,
      y0: event.clientY,
      at: clock.now(),
      x: event.clientX,
      y: event.clientY,
      moved: false,
    })
    push()
  }
  const move = (event: PointerEvent): void => {
    const touch = touches.get(event.pointerId)
    if (touch === undefined) return
    event.stopImmediatePropagation()
    if (touch.role === 'look') {
      send({
        turn: (event.clientX - touch.x) * LOOK_PER_PIXEL,
        tilt: -(event.clientY - touch.y) * LOOK_PER_PIXEL,
      })
    }
    touch.x = event.clientX
    touch.y = event.clientY
    if (Math.hypot(touch.x - touch.x0, touch.y - touch.y0) > TAP_PIXELS) touch.moved = true
    push()
  }
  const up = (event: PointerEvent): void => {
    const touch = touches.get(event.pointerId)
    if (touch === undefined) return
    touches.delete(event.pointerId)
    event.stopImmediatePropagation()
    if (!touch.moved && clock.now() - touch.at < TAP_MS) acts.dig()
    push()
  }
  const noMenu = (event: Event): void => {
    if (walking()) event.preventDefault()
  }
  const placeDown = (event: PointerEvent): void => {
    event.preventDefault()
    acts.build()
  }
  const keyDown = (event: KeyboardEvent): void => {
    if (!walking() || event.target instanceof HTMLInputElement) return
    if (event.key === ' ') {
      event.preventDefault()
      send({ jump: true })
      return
    }
    keys.add(event.key.length === 1 ? event.key.toLowerCase() : event.key)
    push()
  }
  const keyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      send({ jump: false })
      return
    }
    keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)
    push()
  }
  const jumpDown = (event: PointerEvent): void => {
    event.preventDefault()
    send({ jump: true })
  }
  const jumpUp = (): void => {
    send({ jump: false })
  }

  target.addEventListener('pointerdown', down, { capture: true })
  target.addEventListener('pointermove', move, { capture: true })
  target.addEventListener('pointerup', up, { capture: true })
  target.addEventListener('pointercancel', up, { capture: true })
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  jump.addEventListener('pointerdown', jumpDown)
  jump.addEventListener('pointerup', jumpUp)
  jump.addEventListener('pointercancel', jumpUp)
  place.addEventListener('pointerdown', placeDown)
  target.addEventListener('contextmenu', noMenu)
  return () => {
    place.removeEventListener('pointerdown', placeDown)
    target.removeEventListener('contextmenu', noMenu)
    target.removeEventListener('pointerdown', down, { capture: true })
    target.removeEventListener('pointermove', move, { capture: true })
    target.removeEventListener('pointerup', up, { capture: true })
    target.removeEventListener('pointercancel', up, { capture: true })
    window.removeEventListener('keydown', keyDown)
    window.removeEventListener('keyup', keyUp)
    jump.removeEventListener('pointerdown', jumpDown)
    jump.removeEventListener('pointerup', jumpUp)
    jump.removeEventListener('pointercancel', jumpUp)
  }
}
