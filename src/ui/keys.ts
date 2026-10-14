/**
 * The keyboard, as a pure decision: a key and what is on screen in, one
 * action out. main.ts carries it out. An open sheet takes the keys first —
 * Escape (and M for the map) puts it away and nothing else reaches the
 * flight — then P and M work anywhere outside a text field, and arrows,
 * WASD and Escape steer and land a glide.
 */
type Sheet = 'map' | 'atlas' | 'system' | 'postcard' | 'none'

export interface KeyState {
  readonly open: Sheet
  /** The key went to a text field (the postcard's caption). */
  readonly typing: boolean
  readonly flying: boolean
  /** Flying between worlds: the system sheet cannot be put away midway. */
  readonly journeying: boolean
}

export type KeyAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'close-map' | 'close-atlas' | 'close-system' | 'close-postcard' }
  | { readonly kind: 'send-postcard' | 'picture' | 'map' | 'land' }
  | { readonly kind: 'nudge'; readonly turn: number; readonly climb: number }

/** Turn and climb a key asks of the glide, as the stick's own units. */
const STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-0.04, 0],
  ArrowRight: [0.04, 0],
  ArrowUp: [0, -0.06],
  ArrowDown: [0, 0.06],
  a: [-0.04, 0],
  d: [0.04, 0],
  w: [0, -0.06],
  s: [0, 0.06],
}

const NONE: KeyAction = { kind: 'none' }
const isP = (key: string): boolean => key === 'p' || key === 'P'
const isM = (key: string): boolean => key === 'm' || key === 'M'

export function keyAction(key: string, state: KeyState): KeyAction {
  switch (state.open) {
    case 'map':
      return key === 'Escape' || isM(key) ? { kind: 'close-map' } : NONE
    case 'atlas':
      return key === 'Escape' ? { kind: 'close-atlas' } : NONE
    case 'system':
      return key === 'Escape' && !state.journeying ? { kind: 'close-system' } : NONE
    case 'postcard':
      if (key === 'Escape') return { kind: 'close-postcard' }
      return isP(key) && !state.typing ? { kind: 'send-postcard' } : NONE
    case 'none':
      break
  }
  if (state.typing) return NONE
  if (isP(key)) return { kind: 'picture' }
  if (isM(key)) return { kind: 'map' }
  if (!state.flying) return NONE
  const step = STEPS[key]
  if (step !== undefined) return { kind: 'nudge', turn: step[0], climb: step[1] }
  return key === 'Escape' ? { kind: 'land' } : NONE
}
