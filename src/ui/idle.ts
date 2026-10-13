/**
 * The chrome steps away while a flight or a tour carries on untouched:
 * `idle` on the body after `IDLE_MS` without a hand on anything, and only
 * while one of those is under way, since an orbit is something you look
 * at to choose what to press. Any pointer, touch, wheel or key brings it
 * back at once. The CSS in index.html says what `idle` hides.
 */
import type { Clock } from '@/app/clock'

export const IDLE_MS = 3500

/** Whether the chrome should be away: under way, and untouched long enough. */
export const isIdle = (underWay: boolean, sinceInputMs: number): boolean =>
  underWay && sinceInputMs >= IDLE_MS

export const attachIdle = (body: HTMLElement, clock: Clock): void => {
  let last = clock.now()
  const underWay = (): boolean =>
    (body.classList.contains('flying') || body.classList.contains('touring')) &&
    !body.classList.contains('postcarding') &&
    !body.classList.contains('systeming')
  const update = (): void => {
    body.classList.toggle('idle', isIdle(underWay(), clock.now() - last))
  }
  const wake = (): void => {
    last = clock.now()
    update()
  }
  for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) {
    window.addEventListener(type, wake, { passive: true })
  }
  window.setInterval(update, 500)
}
