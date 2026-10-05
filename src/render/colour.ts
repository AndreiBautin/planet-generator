import * as THREE from 'three'

import type { Rgb } from '@/generation/kinds'

/**
 * A palette colour as Three.js wants it. The palette is written in sRGB —
 * the hex a person picks — and the renderer works in linear light, so a
 * palette colour handed over raw comes out pale and washed out.
 */
export const fromPalette = ([r, g, b]: Rgb): THREE.Color =>
  new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)
