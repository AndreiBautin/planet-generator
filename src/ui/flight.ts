/**
 * Whether the camera is orbiting, gliding, or on its way between the two —
 * and how far along that way it is.
 *
 * The scene draws a blend of the orbit camera and the gliding camera; this
 * decides the blend from the time since the last change, so a dive plays
 * over the same two seconds however the frames fall, and Land pressed in
 * the middle of a dive rises from wherever the dive had got to.
 */
export type FlightMode = 'orbit' | 'diving' | 'gliding' | 'rising'

export interface Flight {
  readonly mode: FlightMode
  /** Clock time of the last change, in milliseconds. */
  readonly since: number
  /** The blend when the last change began, so a reversal starts where it is. */
  readonly from: number
}

export const DIVE_MS = 2400
export const RISE_MS = 2000

export const ORBITING: Flight = { mode: 'orbit', since: 0, from: 0 }

const ease = (t: number): number => {
  const k = Math.min(1, Math.max(0, t))
  return k * k * (3 - 2 * k)
}

/** 0 is the orbit camera, 1 the gliding camera. */
export function blendOf(flight: Flight, now: number): number {
  switch (flight.mode) {
    case 'orbit':
      return 0
    case 'gliding':
      return 1
    case 'diving':
      return flight.from + (1 - flight.from) * ease((now - flight.since) / DIVE_MS)
    case 'rising':
      return flight.from * (1 - ease((now - flight.since) / RISE_MS))
  }
}

/** A dive that has landed is gliding; a rise that has arrived is orbiting. */
export function settleFlight(flight: Flight, now: number): Flight {
  if (flight.mode === 'diving' && now - flight.since >= DIVE_MS)
    return { mode: 'gliding', since: now, from: 1 }
  if (flight.mode === 'rising' && now - flight.since >= RISE_MS)
    return { mode: 'orbit', since: now, from: 0 }
  return flight
}

export function dive(flight: Flight, now: number): Flight {
  if (flight.mode === 'diving' || flight.mode === 'gliding') return flight
  return { mode: 'diving', since: now, from: blendOf(flight, now) }
}

export function rise(flight: Flight, now: number): Flight {
  if (flight.mode === 'rising' || flight.mode === 'orbit') return flight
  return { mode: 'rising', since: now, from: blendOf(flight, now) }
}

/** Whether a finger steers the glide rather than the orbit. */
export const steersGlide = (flight: Flight): boolean =>
  flight.mode === 'diving' || flight.mode === 'gliding'
