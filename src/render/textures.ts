import * as THREE from 'three'

import { bakeGroundTile, GROUND_KINDS, TILE, type GroundKind } from './ground-atlas'

/**
 * The ground's textures as GPU textures, made once for the page and shared
 * by every planet: they describe kinds of ground, not a planet, so a New
 * planet press reuses them.
 *
 * Two sources, one after the other. The baked tiles (`ground-atlas.ts`) are
 * ready the instant the page is, so the first frame has texture; the
 * photographs in `public/textures/` — CC0 scans from ambientCG, colour and
 * normal, cut to 512 px — replace them as they arrive. The biome grounds
 * are Ground077 (needles), Ground003 (savanna), Moss001 (tundra), Gravel024
 * (ash) and Ground031 (salt flat); the four on land ship colour only. The swap is a change
 * of `value` on a shared uniform object, which every compiled ground
 * material reads each frame, so nothing recompiles and nothing is told.
 *
 * Each photograph carries its own mean brightness (`mean`, linear
 * luminance measured when it was cut) so the shader can level it: the
 * biome's colour is multiplied by the photo's structure, not replaced by
 * its colour, and an ochre world stays ochre with grass-shaped grain. The
 * baked tiles were drawn around mid-grey, hence their mean of 0.5.
 *
 * The colour maps are sRGB and decoded on sampling (`SRGBColorSpace`, so
 * the GPU does it and the mipmaps are built in linear light). Read raw,
 * the bytes came out far brighter than the linear mean they are levelled
 * by — grass 0.32 against 0.09 — and every sunlit slope was pushed onto
 * the tone map's shoulder, where the grain flattened to nothing. The
 * baked tiles and the normal maps are linear and stay so.
 */
export interface GroundLayer {
  readonly color: { value: THREE.Texture }
  /** The normal map, GL convention; null until the photograph arrives. */
  readonly normal: { value: THREE.Texture | null }
  readonly mean: { value: number }
}
export type GroundTextures = Readonly<Record<GroundKind, GroundLayer>>

/** Mean linear luminance of each photograph's colour map, measured when it was cut. */
const PHOTO_MEANS: Readonly<Record<GroundKind, number>> = {
  grass: 0.0918,
  litter: 0.2904,
  sand: 0.2661,
  stone: 0.0772,
  snow: 0.5811,
  basalt: 0.0118,
  needles: 0.2375,
  savanna: 0.2032,
  tundra: 0.2247,
  ash: 0.0708,
  salt: 0.2464,
}

let shared: GroundTextures | undefined

/** The biome grounds on land ship a colour map and no normal map (see detail.ts). */
const COLOUR_ONLY: ReadonlySet<GroundKind> = new Set(['needles', 'savanna', 'tundra', 'salt'])

function repeating(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  return texture
}

export function groundTextures(base = '/'): GroundTextures {
  if (shared !== undefined) return shared
  const made: Partial<Record<GroundKind, GroundLayer>> = {}
  const loader = new THREE.TextureLoader()
  for (const kind of GROUND_KINDS) {
    const baked = repeating(
      new THREE.DataTexture(bakeGroundTile(kind).data, TILE, TILE, THREE.RGBAFormat),
    )
    baked.needsUpdate = true
    const layer: GroundLayer = {
      color: { value: baked },
      normal: { value: null },
      mean: { value: 0.5 },
    }
    made[kind] = layer
    loader.load(`${base}textures/${kind}-color.jpg`, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      layer.color.value = repeating(texture)
      layer.mean.value = PHOTO_MEANS[kind]
      baked.dispose()
    })
    if (!COLOUR_ONLY.has(kind)) {
      loader.load(`${base}textures/${kind}-normal.jpg`, (texture) => {
        layer.normal.value = repeating(texture)
      })
    }
  }
  shared = made as GroundTextures
  return shared
}
