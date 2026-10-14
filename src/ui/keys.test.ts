import { describe, expect, it } from 'vitest'

import { keyAction, type KeyState } from './keys'

const idle: KeyState = { open: 'none', typing: false, flying: false, journeying: false }
const flying: KeyState = { ...idle, flying: true }

describe('keyAction', () => {
  it('lets an open sheet take the keys before the flight does', () => {
    expect(keyAction('Escape', { ...flying, open: 'map' }).kind).toBe('close-map')
    expect(keyAction('m', { ...flying, open: 'map' }).kind).toBe('close-map')
    expect(keyAction('ArrowLeft', { ...flying, open: 'atlas' }).kind).toBe('none')
    expect(keyAction('Escape', { ...flying, open: 'atlas' }).kind).toBe('close-atlas')
  })

  it('keeps the system sheet up while flying between worlds', () => {
    expect(keyAction('Escape', { ...idle, open: 'system' }).kind).toBe('close-system')
    expect(keyAction('Escape', { ...idle, open: 'system', journeying: true }).kind).toBe('none')
  })

  it('sends a postcard on P, but not while its caption is being typed', () => {
    expect(keyAction('p', { ...idle, open: 'postcard' }).kind).toBe('send-postcard')
    expect(keyAction('P', { ...idle, open: 'postcard', typing: true }).kind).toBe('none')
    expect(keyAction('Escape', { ...idle, open: 'postcard', typing: true }).kind).toBe(
      'close-postcard',
    )
  })

  it('takes a picture or opens the map anywhere, but not into a text field', () => {
    expect(keyAction('p', idle).kind).toBe('picture')
    expect(keyAction('M', flying).kind).toBe('map')
    expect(keyAction('p', { ...idle, typing: true }).kind).toBe('none')
  })

  it('steers and lands only a glide', () => {
    expect(keyAction('ArrowLeft', idle).kind).toBe('none')
    expect(keyAction('Escape', idle).kind).toBe('none')
    expect(keyAction('ArrowLeft', flying)).toEqual({ kind: 'nudge', turn: -0.04, climb: 0 })
    expect(keyAction('s', flying)).toEqual({ kind: 'nudge', turn: 0, climb: 0.06 })
    expect(keyAction('Escape', flying).kind).toBe('land')
  })
})
