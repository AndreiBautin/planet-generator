import type { Shot } from '@/app/link'

import type { Vec3 } from './glide'

/**
 * Postcard mode's arithmetic: the frame a picture is cut to, the local
 * hour at a point as the planet turns under a fixed sun, the turn that
 * gives a chosen hour, and a viewpoint written as latitude, longitude and
 * bearing so it can travel in a link.
 *
 * The planet's frame turns into the room's about the y axis: a point's
 * longitude grows by the turn (scene.ts, `intoRoom`), so the hour is how
 * far round from the sun's own longitude the point has been carried.
 */
export type Framing = 'screen' | 'wide' | 'tall' | 'square'

export const FRAMINGS: Readonly<
  Record<Framing, { readonly label: string; readonly ratio: number | undefined }>
> = {
  screen: { label: 'Screen', ratio: undefined },
  wide: { label: '3:2', ratio: 3 / 2 },
  tall: { label: '4:5', ratio: 4 / 5 },
  square: { label: '1:1', ratio: 1 },
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The largest frame of a framing's shape inside `area`, `margin` in from its edges, centred. */
export function frameIn(framing: Framing, area: Rect, margin: number): Rect {
  const width = Math.max(1, area.width - margin * 2)
  const height = Math.max(1, area.height - margin * 2)
  const ratio = FRAMINGS[framing].ratio
  if (ratio === undefined) return { x: area.x + margin, y: area.y + margin, width, height }
  const fitted =
    width / height > ratio ? { width: height * ratio, height } : { width, height: width / ratio }
  return {
    x: area.x + (area.width - fitted.width) / 2,
    y: area.y + (area.height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  }
}

const TAU = Math.PI * 2
const wrap = (value: number, span: number): number => ((value % span) + span) % span
const longitudeOf = (v: Vec3): number => Math.atan2(v[0], v[2])

/** The local hour, 0 to 24, at `point` (the planet's frame) with the planet turned by `turn` and the sun at `sun` (the room's). */
export function hourAt(point: Vec3, sun: Vec3, turn: number): number {
  const angle = longitudeOf(point) + turn - longitudeOf(sun)
  return wrap(12 + (angle / TAU) * 24, 24)
}

/** The turn nearest `near` that puts `hour` at `point`: the planet moves the short way to it. */
export function turnForHour(point: Vec3, sun: Vec3, hour: number, near: number): number {
  const exact = longitudeOf(sun) - longitudeOf(point) + ((hour - 12) / 24) * TAU
  return exact + Math.round((near - exact) / TAU) * TAU
}

/** "06:40": an hour as a clock reads it. */
export function clockLabel(hour: number): string {
  const minutes = Math.round(wrap(hour, 24) * 60) % (24 * 60)
  const hh = Math.floor(minutes / 60)
  const mm = minutes % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** A slider's 0 to 1 as a height between `low` and `high`, evenly by ratio: a step near the ground is as noticeable as one high up. */
export const heightFrom = (t: number, low: number, high: number): number =>
  low * Math.pow(high / low, Math.min(1, Math.max(0, t)))

export const sliderFrom = (height: number, low: number, high: number): number =>
  Math.min(1, Math.max(0, Math.log(height / low) / Math.log(high / low)))

const DEGREES = 180 / Math.PI

/** East and north along the ground at a unit `point`; at a pole, any pair at right angles. */
function compass(point: Vec3): { readonly east: Vec3; readonly north: Vec3 } {
  const [x, , z] = point
  const flat = Math.hypot(x, z)
  const east: Vec3 = flat < 1e-6 ? [1, 0, 0] : [z / flat, 0, -x / flat]
  const north: Vec3 = [
    point[1] * east[2] - point[2] * east[1],
    point[2] * east[0] - point[0] * east[2],
    point[0] * east[1] - point[1] * east[0],
  ]
  return { east, north }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** A unit direction from latitude and longitude, in degrees. */
export function directionOf(latitude: number, longitude: number): Vec3 {
  const lat = latitude / DEGREES
  const lon = longitude / DEGREES
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
}

/** A heading along the ground at `point`, from a bearing in degrees east of north. */
export function headingOf(point: Vec3, bearing: number): Vec3 {
  const { east, north } = compass(point)
  const b = bearing / DEGREES
  return [
    north[0] * Math.cos(b) + east[0] * Math.sin(b),
    north[1] * Math.cos(b) + east[1] * Math.sin(b),
    north[2] * Math.cos(b) + east[2] * Math.sin(b),
  ]
}

/** A viewpoint as a link carries it. */
export function shotOf(
  kind: Shot['kind'],
  point: Vec3,
  heading: Vec3 | undefined,
  height: number,
  hour: number,
  tilt = 0,
): Shot {
  const length = Math.hypot(...point) || 1
  const unit: Vec3 = [point[0] / length, point[1] / length, point[2] / length]
  let bearing = 0
  if (heading !== undefined) {
    const { east, north } = compass(unit)
    bearing = wrap(Math.atan2(dot(heading, east), dot(heading, north)) * DEGREES, 360)
  }
  return {
    kind,
    latitude: Math.asin(Math.max(-1, Math.min(1, unit[1]))) * DEGREES,
    longitude: longitudeOf(unit) * DEGREES,
    bearing,
    height,
    hour,
    tilt: tilt * DEGREES,
  }
}
