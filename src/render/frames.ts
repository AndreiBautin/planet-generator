import type { Vec3 } from '@/generation/cube'

/**
 * The room's frame and the planet's: the planet turns about y and grows
 * through its birth, and everything that reads the ground from the camera
 * goes between the two through here.
 */
/** 0 below `from`, 1 above `to`, eased between. */
export function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

export const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** A point in the planet's own frame, carried round to where the planet has turned to. */
export function intoRoom(point: Vec3, turn: number): [number, number, number] {
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  return [point[0] * cos + point[2] * sin, point[1], -point[0] * sin + point[2] * cos]
}

/**
 * The camera in the planet's own frame: undo the planet's turn about its
 * axis and its birth scale, so the terrain is split for where the camera is
 * relative to the ground rather than relative to the room.
 */
export function inPlanetFrame(
  position: { readonly x: number; readonly y: number; readonly z: number },
  turn: number,
  scale: number,
): Vec3 {
  const cos = Math.cos(-turn)
  const sin = Math.sin(-turn)
  const x = position.x * cos + position.z * sin
  const z = -position.x * sin + position.z * cos
  const s = scale > 0 ? 1 / scale : 1
  return [x * s, position.y * s, z * s]
}
