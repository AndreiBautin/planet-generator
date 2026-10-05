import * as THREE from 'three'

import type { Planet } from '@/generation/planet'

import { fromPalette } from './colour'

/**
 * The sea: a smooth sphere at sea level over the sunken floor. Translucent,
 * so the floor's shading reads as depth through it, and glossy, so the sun
 * leaves a glint that slides across the ocean as the planet turns.
 *
 * A molten sea is not water: it is opaque, rough and lit from within.
 */
export const SEA_RADIUS = 1.0015

export function buildWater(planet: Planet, detail: number): THREE.Mesh {
  const geometry = new THREE.IcosahedronGeometry(SEA_RADIUS, detail)
  // Tinted towards the deep colour: tinted with the shallow one, the whole
  // ocean read as one bright turquoise and the floor's depth was lost.
  const colour = fromPalette(planet.palette.deep).lerp(fromPalette(planet.palette.shallow), 0.35)

  const material = planet.molten
    ? new THREE.MeshStandardMaterial({
        // Dark crust lit by its own glow: a bright base colour plus the
        // sun's light washed the lava out to pale yellow.
        color: new THREE.Color(0x1a0600),
        emissive: fromPalette(planet.palette.deep),
        emissiveIntensity: 1.6,
        roughness: 0.7,
        metalness: 0,
      })
    : new THREE.MeshPhysicalMaterial({
        color: colour,
        transparent: true,
        opacity: 0.5,
        roughness: 0.18,
        metalness: 0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.12,
      })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1
  return mesh
}
