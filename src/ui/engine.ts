/**
 * The ship's engine, heard at the two moments that matter: a swell as it
 * lifts off and a falling note as it sets down. Synthesised with Web
 * Audio so no file ships, and made on the first press that asks for it,
 * because a browser only opens audio inside a gesture.
 *
 * Nothing here is recorded or sent anywhere; it is two oscillators and a
 * filter for a couple of seconds.
 */
export interface Engine {
  readonly liftOff: () => void
  readonly setDown: () => void
}

export function createEngine(): Engine {
  let context: AudioContext | undefined
  const open = (): AudioContext | undefined => {
    if (context === undefined && 'AudioContext' in window) context = new AudioContext()
    if (context?.state === 'suspended') void context.resume()
    return context
  }

  /** A throb: two detuned saws through a low-pass, with a gain and pitch envelope. */
  const throb = (
    audio: AudioContext,
    from: number,
    to: number,
    seconds: number,
    peak: number,
  ): void => {
    const now = audio.currentTime
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + seconds * 0.3)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    const filter = audio.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(from * 6, now)
    filter.frequency.exponentialRampToValueAtTime(to * 6, now + seconds)
    filter.Q.value = 2
    for (const detune of [-7, 7]) {
      const osc = audio.createOscillator()
      osc.type = 'sawtooth'
      osc.detune.value = detune
      osc.frequency.setValueAtTime(from, now)
      osc.frequency.exponentialRampToValueAtTime(to, now + seconds)
      osc.connect(filter)
      osc.start(now)
      osc.stop(now + seconds + 0.05)
    }
    filter.connect(gain)
    gain.connect(audio.destination)
  }

  return {
    liftOff: () => {
      const audio = open()
      if (audio !== undefined) throb(audio, 48, 110, 2.4, 0.12)
    },
    setDown: () => {
      const audio = open()
      if (audio !== undefined) throb(audio, 96, 40, 1.8, 0.1)
    },
  }
}
