import { createRng } from '@/generation/rng'

/**
 * What a flight sounds like, made in the browser from noise: wind that
 * rises with the speed and dies away towards orbit, surf along a coast,
 * rain under a storm, and thunder rolling in a few seconds after each
 * flash, later the further off it struck. No sound files: four filtered
 * noises and their levels.
 *
 * Off until asked for, by a press (browsers only let sound start inside a
 * gesture, and a page that makes a noise unasked is a page closed).
 *
 * `mixFor` is the whole decision of how loud each part is, pure, so it can
 * be tested; the class only follows it.
 */
export interface Weather {
  /** How fast the eye is moving, in planet radii a second. */
  readonly speed: number
  /** How far above the ground the eye is, in planet radii. */
  readonly above: number
  /** How much of the ground near the eye is coast, 0 to 1: sea and land both close by. */
  readonly coast: number
  /** How heavy the shower over the eye is, 0 to 1. */
  readonly rain: number
}

export interface Mix {
  readonly wind: number
  /** The wind's pitch, in hertz: higher when faster. */
  readonly windPitch: number
  readonly surf: number
  readonly rain: number
}

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

export function mixFor(weather: Weather): Mix {
  // In the air at all: there is no wind in orbit.
  const inAir = 1 - smooth(0.12, 0.3, weather.above)
  const rush = Math.min(1, weather.speed / 0.02)
  return {
    wind: inAir * (0.12 + 0.5 * rush),
    windPitch: 260 + 900 * rush,
    // The sea is heard only low over it.
    surf: weather.coast * (1 - smooth(0.006, 0.04, weather.above)) * 0.6,
    rain: weather.rain * inAir * 0.5,
  }
}

/** Seconds for thunder to arrive from a flash `angle` radians away, and how loud it is then. */
export function thunderFrom(angle: number): { readonly delay: number; readonly loudness: number } {
  return { delay: 0.4 + angle * 60, loudness: Math.max(0, 1 - angle / 0.16) }
}

export class Soundscape {
  private context: AudioContext | undefined
  private master: GainNode | undefined
  private parts:
    { wind: GainNode; windFilter: BiquadFilterNode; surf: GainNode; rain: GainNode } | undefined
  private noise: AudioBuffer | undefined
  private on = false

  get playing(): boolean {
    return this.on
  }

  /** Turn the sound on or off; on, the first time, builds it. Call from inside a press. */
  toggle(): boolean {
    this.on = !this.on
    if (this.on && this.context === undefined) this.build()
    const context = this.context
    if (context !== undefined && this.master !== undefined) {
      if (this.on) void context.resume()
      this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, context.currentTime, 0.15)
    }
    return this.on
  }

  /** Follow the flight: called once a frame or so. */
  update(weather: Weather, seconds: number): void {
    const context = this.context
    const parts = this.parts
    if (!this.on || context === undefined || parts === undefined) return
    const mix = mixFor(weather)
    const now = context.currentTime
    // Gusts: the wind breathes on a slow swing of its own.
    const gust = 0.8 + 0.2 * Math.sin(seconds * 0.7) * Math.sin(seconds * 0.23 + 1)
    parts.wind.gain.setTargetAtTime(mix.wind * gust, now, 0.3)
    parts.windFilter.frequency.setTargetAtTime(mix.windPitch * (0.9 + 0.2 * gust), now, 0.3)
    // Surf comes in sets, a breaker every several seconds.
    const swell = Math.pow(0.5 + 0.5 * Math.sin(seconds * 0.9), 3)
    parts.surf.gain.setTargetAtTime(mix.surf * (0.35 + 0.65 * swell), now, 0.25)
    parts.rain.gain.setTargetAtTime(mix.rain, now, 0.4)
  }

  /** A clap of thunder, `angle` radians away: rolls in after its delay, if near enough to hear. */
  thunder(angle: number): void {
    const context = this.context
    const master = this.master
    const noise = this.noise
    if (!this.on || context === undefined || master === undefined || noise === undefined) return
    const { delay, loudness } = thunderFrom(angle)
    if (loudness <= 0.02) return
    const start = context.currentTime + delay
    const source = context.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(320 + loudness * 300, start)
    filter.frequency.exponentialRampToValueAtTime(90, start + 4)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.9 * loudness, start + 0.08)
    gain.gain.setTargetAtTime(0.25 * loudness, start + 0.3, 0.4)
    gain.gain.setTargetAtTime(0, start + 1.2, 1.1)
    source.connect(filter).connect(gain).connect(master)
    source.start(start, Math.max(0, angle * 7) % 2)
    source.stop(start + 6)
  }

  /**
   * The soundscape as a stream, for a clip to carry: the same mix the
   * speakers get, silent while the sound is off. None before the sound has
   * ever been turned on, since the browser starts no audio without a press.
   */
  stream(): MediaStream | undefined {
    if (this.context === undefined || this.master === undefined) return undefined
    if (this.tap === undefined) {
      this.tap = this.context.createMediaStreamDestination()
      this.master.connect(this.tap)
    }
    return this.tap.stream
  }

  private tap: MediaStreamAudioDestinationNode | undefined

  private build(): void {
    const Context = window.AudioContext as typeof AudioContext | undefined
    if (Context === undefined) return
    const context = new Context()
    // Two seconds of noise, seeded, so nothing here reaches for Math.random.
    const rng = createRng('soundscape')
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let k = 0; k < samples.length; k += 1) samples[k] = rng.next() * 2 - 1
    const master = context.createGain()
    master.gain.value = 0
    master.connect(context.destination)
    const voice = (
      type: BiquadFilterType,
      frequency: number,
      q: number,
    ): { gain: GainNode; filter: BiquadFilterNode } => {
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = context.createBiquadFilter()
      filter.type = type
      filter.frequency.value = frequency
      filter.Q.value = q
      const gain = context.createGain()
      gain.gain.value = 0
      source.connect(filter).connect(gain).connect(master)
      // Each voice starts at its own place in the noise, so they are not one sound thrice.
      source.start(0, rng.next() * 2)
      return { gain, filter }
    }
    const wind = voice('bandpass', 400, 0.7)
    const surf = voice('lowpass', 450, 0.5)
    const rain = voice('highpass', 2400, 0.5)
    this.context = context
    this.master = master
    this.noise = buffer
    this.parts = { wind: wind.gain, windFilter: wind.filter, surf: surf.gain, rain: rain.gain }
  }
}
