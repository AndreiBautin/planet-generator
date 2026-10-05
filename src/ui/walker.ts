/**
 * Walking on a landing: where the surveyor stands, how they move, and how
 * the ground stops them. All in block units in the landing's own frame —
 * x east, y up, z north — which is what makes it testable against a
 * made-up ground.
 *
 * Pure, like the glide: the blocks are a parameter, a function from a
 * block position to what is there, so the walker can be tested on a
 * floor of three blocks and the renderer stays the only thing that knows
 * how chunks are kept.
 */
export type Stuff = 'air' | 'solid' | 'liquid'
export type StuffAt = (x: number, y: number, z: number) => Stuff

export interface Walker {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  /** Heading, radians, 0 facing +z (north), turning right positive. */
  readonly yaw: number
  /** Up positive, radians. */
  readonly pitch: number
  readonly onGround: boolean
  readonly swimming: boolean
}

export interface WalkInput {
  /** −1 to 1: back to forward. */
  readonly forward: number
  /** −1 to 1: left to right. */
  readonly strafe: number
  readonly jump: boolean
  /** Look deltas since the last step, radians. */
  readonly turn: number
  readonly tilt: number
}

export const STILL: WalkInput = { forward: 0, strafe: 0, jump: false, turn: 0, tilt: 0 }

/** The surveyor's body, in blocks. */
export const HALF_WIDTH = 0.3
export const BODY_HEIGHT = 1.75
export const EYE_HEIGHT = 1.6
const WALK_SPEED = 4.4
const SWIM_SPEED = 2.2
const GRAVITY = 26
const JUMP = 8.4
const MAX_PITCH = Math.PI / 2 - 0.05
/** How far the walker can step up without jumping. */
const STEP_UP = 1.02

export function standWalker(x: number, y: number, z: number, yaw = 0): Walker {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: -0.1, onGround: false, swimming: false }
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

/** Whether the body at (x, y, z) overlaps a solid block. */
function blocked(x: number, y: number, z: number, stuff: StuffAt): boolean {
  const x0 = Math.floor(x - HALF_WIDTH)
  const x1 = Math.floor(x + HALF_WIDTH)
  const z0 = Math.floor(z - HALF_WIDTH)
  const z1 = Math.floor(z + HALF_WIDTH)
  const y0 = Math.floor(y)
  const y1 = Math.floor(y + BODY_HEIGHT - 0.01)
  for (let bx = x0; bx <= x1; bx += 1) {
    for (let bz = z0; bz <= z1; bz += 1) {
      for (let by = y0; by <= y1; by += 1) {
        if (stuff(bx, by, bz) === 'solid') return true
      }
    }
  }
  return false
}

/**
 * One step of walking: turn, push along the ground the way the stick
 * says, fall or swim, and let the blocks stop the body one axis at a
 * time, so sliding along a wall works and a low step is climbed.
 */
export function stepWalker(
  walker: Walker,
  input: WalkInput,
  seconds: number,
  stuff: StuffAt,
): Walker {
  if (!(seconds > 0)) return walker
  const dt = Math.min(seconds, 0.05)
  const yaw = walker.yaw + input.turn
  const pitch = clamp(walker.pitch + input.tilt, -MAX_PITCH, MAX_PITCH)

  const inWater =
    stuff(Math.floor(walker.x), Math.floor(walker.y + 0.9), Math.floor(walker.z)) === 'liquid'
  const speed = inWater ? SWIM_SPEED : WALK_SPEED
  // Forward is +z turned by the yaw; right is +x turned the same way.
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const push = Math.hypot(input.forward, input.strafe)
  const scale = push > 1 ? 1 / push : 1
  const vx = (fx * input.forward + fz * input.strafe) * scale * speed
  const vz = (fz * input.forward - fx * input.strafe) * scale * speed

  let vy = walker.vy
  if (inWater) {
    vy = input.jump ? 3 : Math.max(-2, vy - GRAVITY * 0.15 * dt)
  } else {
    vy -= GRAVITY * dt
    if (input.jump && walker.onGround) vy = JUMP
  }

  let x = walker.x
  let y = walker.y
  let z = walker.z
  // Sideways first, with a step up over a low edge.
  const tryMove = (dx: number, dz: number): void => {
    if (!blocked(x + dx, y, z + dz, stuff)) {
      x += dx
      z += dz
      return
    }
    if (!blocked(x + dx, y + STEP_UP, z + dz, stuff) && !inWater) {
      x += dx
      z += dz
      y += STEP_UP
    }
  }
  tryMove(vx * dt, 0)
  tryMove(0, vz * dt)
  // Then up or down.
  let onGround = false
  const dy = vy * dt
  if (blocked(x, y + dy, z, stuff)) {
    if (dy < 0) {
      // Settle onto the block below.
      y = Math.floor(y + dy) + 1
      onGround = true
    } else {
      y = Math.ceil(y + dy + BODY_HEIGHT) - BODY_HEIGHT - 0.01
    }
    vy = 0
  } else {
    y += dy
  }
  // Standing on the ground counts even when not falling into it this step.
  if (!onGround && vy <= 0 && blocked(x, y - 0.02, z, stuff)) onGround = true

  return { x, y, z, vx, vy, vz, yaw, pitch, onGround, swimming: inWater }
}

/** Where the eyes are and which way they look, in the landing's frame. */
export function eyeOf(walker: Walker): {
  readonly eye: readonly [number, number, number]
  readonly forward: readonly [number, number, number]
} {
  const cp = Math.cos(walker.pitch)
  return {
    eye: [walker.x, walker.y + EYE_HEIGHT, walker.z],
    forward: [Math.sin(walker.yaw) * cp, Math.sin(walker.pitch), Math.cos(walker.yaw) * cp],
  }
}
