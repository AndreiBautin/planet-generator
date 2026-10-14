import type { Vec3 } from '@/generation/cube'

import type { createRig } from './rig'

export interface DiveButtonParts {
  readonly rig: Pick<ReturnType<typeof createRig>, 'submerge' | 'submerged' | 'onSurface'>
  /** The sea bed's radius under a direction, on the planet now shown. */
  readonly floorAt: (direction: Vec3) => number
  readonly tell: (message: string) => void
}

/**
 * Under the sea: the glide flies over the sea bed instead of over the
 * surface, until the water grows too shallow or the button is pressed
 * again (rig.ts `submerge`, render/underwater.ts).
 */
export function attachDiveButton({ rig, floorAt, tell }: DiveButtonParts): void {
  const button = document.getElementById('dive')
  const show = (under: boolean): void => {
    button?.setAttribute('aria-pressed', String(under))
    button?.setAttribute('aria-label', under ? 'Come up for air' : 'Dive under the sea')
  }
  button?.addEventListener('click', () => {
    if (rig.submerged()) {
      rig.submerge(undefined)
      show(false)
      return
    }
    const went = rig.submerge(floorAt)
    show(went)
    if (!went) tell('Fly over open sea to dive')
  })
  rig.onSurface((shallow) => {
    show(false)
    if (shallow) tell('Too shallow · surfaced')
  })
}
