import * as THREE from 'three'

import { hasModule, type Ship } from '@/generation/expedition'

/**
 * The airship, seen from behind in the glide: a hull, a gondola slung
 * under it, fins, and whatever modules have been fitted — a bigger hull
 * for the hold, lamps that glow, a drill under the bow, shield plates, ice
 * runners, a scope on the gondola's nose. Built from a few dozen faceted
 * pieces, the way the trees are; rebuilt only when a module changes.
 *
 * Sized in planet radii and placed by the scene a little ahead of and
 * below the eye, turned the way the glide looks and rolled with its bank,
 * so the ship is what carries the camera rather than a thing in front of
 * it.
 */

/** Length of the hull, in planet radii: about ten blocks. */
export const SHIP_LENGTH = 0.0022

const HULL = new THREE.Color(0.72, 0.68, 0.6)
const CANVAS = new THREE.Color(0.55, 0.5, 0.42)
const BRASS = new THREE.Color(0.7, 0.55, 0.3)
const IRON = new THREE.Color(0.32, 0.33, 0.36)
const GLASS = new THREE.Color(0.6, 0.8, 0.95)

function part(geometry: THREE.BufferGeometry, colour: THREE.Color): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: colour,
      roughness: 0.75,
      metalness: 0.1,
      flatShading: true,
    }),
  )
  mesh.castShadow = true
  return mesh
}

/** The ship as a group a unit long along +z, up +y, centred on the hull. */
export function buildShip(ship: Ship): THREE.Group {
  const group = new THREE.Group()
  const big = hasModule(ship, 'hold')
  // Hull: a stretched sphere, a little wider with the bigger hold.
  const hull = part(
    new THREE.SphereGeometry(0.5, 12, 8).scale(big ? 0.26 : 0.2, big ? 0.24 : 0.19, 1),
    HULL,
  )
  group.add(hull)
  // Fins at the stern.
  for (const [x, y, rz] of [
    [0, 0.14, 0],
    [0, -0.14, 0],
    [0.14, 0, Math.PI / 2],
    [-0.14, 0, Math.PI / 2],
  ] as const) {
    const fin = part(new THREE.BoxGeometry(0.02, 0.14, 0.14), CANVAS)
    fin.position.set(x * (big ? 1.3 : 1), y * (big ? 1.25 : 1), -0.36)
    fin.rotation.z = rz
    group.add(fin)
  }
  // Gondola under the hull, with a windowed nose.
  const gondola = part(new THREE.BoxGeometry(0.08, 0.06, 0.3), IRON)
  gondola.position.set(0, -(big ? 0.15 : 0.12), 0.04)
  group.add(gondola)
  const window = part(new THREE.BoxGeometry(0.06, 0.03, 0.02), GLASS)
  window.position.set(0, -(big ? 0.145 : 0.115), 0.2)
  group.add(window)
  // Engines either side.
  for (const x of [-0.07, 0.07]) {
    const engine = part(
      new THREE.CylinderGeometry(0.02, 0.025, 0.08, 8).rotateX(Math.PI / 2),
      BRASS,
    )
    engine.position.set(x, -(big ? 0.12 : 0.1), -0.08)
    group.add(engine)
  }
  if (hasModule(ship, 'drill')) {
    const drill = part(new THREE.ConeGeometry(0.03, 0.12, 8).rotateX(Math.PI / 2), IRON)
    drill.position.set(0, -(big ? 0.15 : 0.12), 0.26)
    group.add(drill)
  }
  if (hasModule(ship, 'shield')) {
    const plates = part(
      new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45).scale(
        big ? 0.27 : 0.21,
        big ? 0.25 : 0.2,
        1.01,
      ),
      IRON,
    )
    plates.rotation.x = Math.PI
    group.add(plates)
  }
  if (hasModule(ship, 'runners')) {
    for (const x of [-0.05, 0.05]) {
      const runner = part(new THREE.BoxGeometry(0.015, 0.012, 0.34), GLASS)
      runner.position.set(x, -(big ? 0.19 : 0.16), 0.02)
      group.add(runner)
    }
  }
  if (hasModule(ship, 'scope')) {
    const scope = part(new THREE.CylinderGeometry(0.012, 0.016, 0.1, 8).rotateX(Math.PI / 2), BRASS)
    scope.position.set(0.045, -(big ? 0.11 : 0.09), 0.22)
    group.add(scope)
  }
  if (hasModule(ship, 'lamps')) {
    for (const [x, z] of [
      [-0.03, 0.14],
      [0.03, 0.14],
      [0, -0.12],
    ] as const) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 6, 4),
        new THREE.MeshStandardMaterial({
          color: 0xffe9b0,
          emissive: new THREE.Color(1, 0.85, 0.5),
          emissiveIntensity: 2,
        }),
      )
      lamp.position.set(x, -(big ? 0.19 : 0.16), z)
      group.add(lamp)
    }
  }
  group.scale.setScalar(SHIP_LENGTH)
  return group
}

export function releaseShip(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const geometry: unknown = child.geometry
    if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
    const material: unknown = child.material
    if (material instanceof THREE.Material) material.dispose()
  })
}
