import type { BenchFrame } from '@/app/bench'
import { summarise } from '@/app/bench'
import { systemClock, type fixedClock } from '@/app/clock'
import type { Vec3 } from '@/generation/cube'
import { TERRAIN_STATS } from '@/render/patches/terrain'
import type { startScene } from '@/render/scene'
import type { createRig } from '@/ui/rig'

/**
 * Development only: `?record` puts this on `window.recorder`, to drive time
 * and frames by hand and measure them. Loaded by a dynamic import behind
 * `config.developer`, so a production build never contains it.
 */
export interface RecorderParts {
  readonly scene: ReturnType<typeof startScene>
  readonly rig: ReturnType<typeof createRig>
  readonly recordClock: ReturnType<typeof fixedClock>
  readonly canvas: HTMLCanvasElement
}

export function installRecorder({ scene, rig, recordClock, canvas }: RecorderParts): void {
  Object.assign(window, {
    recorder: {
      /** Move time on by `ms` and draw one frame. */
      step: (ms: number) => {
        recordClock.advance(ms)
        scene.step()
      },
      /** Turn and climb as the keyboard does. */
      nudge: (turn: number, climb: number) => {
        rig.nudge(turn, climb)
      },
      /** The three.js scene, to inspect what is drawn. */
      root: scene.root,
      /** What the last frame drew, across every pass. */
      stats: () => scene.stats(),
      /** Mean ms a frame by part of the frame, since the last call. */
      profile: () => scene.profile(),
      sun: () => scene.sunInPlanet(),
      /** The post pipeline's passes, each with `enabled`. */
      postPasses: () => scene.postPasses(),
      /** The terrain's last selection: stand-ins, the nearest, patches pending. */
      terrain: () => ({ ...TERRAIN_STATS }),
      /** Where Fly would start the glide now. */
      diveFrom: () => scene.diveFrom(),
      /** Start the glide from a point of the planet, heading this way (its own frame). */
      glideFrom: (position: Vec3, heading: Vec3) => {
        rig.fly({ position, heading })
      },
      canvas,
      /**
       * The benchmark: `frames` frames at real-time pace (a 33 ms sleep per
       * 33 ms step, so the workers are not starved), summarised. Open a fixed
       * seed with `?record`, then call it once in orbit and once after `tour`.
       */
      bench: async (frames = 300) => {
        const gl = canvas.getContext('webgl2')
        const timer = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as {
          TIME_ELAPSED_EXT: number
        } | null
        const taken: { -readonly [K in keyof BenchFrame]: BenchFrame[K] }[] = []
        // A query's answer comes frames later, if ever (a hidden pane may
        // never finish one): each is read whenever it is ready, and a frame
        // whose answer never came stays unmeasured.
        const waiting: { readonly query: WebGLQuery; readonly frame: number }[] = []
        const collect = (): void => {
          if (gl === null) return
          for (let k = waiting.length - 1; k >= 0; k -= 1) {
            const item = waiting[k]
            if (item === undefined) continue
            if (gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE) !== true) continue
            const frame = taken[item.frame]
            if (frame !== undefined)
              frame.gpuMs = Number(gl.getQueryParameter(item.query, gl.QUERY_RESULT)) / 1e6
            gl.deleteQuery(item.query)
            waiting.splice(k, 1)
          }
        }
        scene.profile()
        for (let i = 0; i < frames; i += 1) {
          const query = gl !== null && timer !== null ? gl.createQuery() : null
          if (gl !== null && timer !== null && query !== null)
            gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
          const start = systemClock.now()
          recordClock.advance(33)
          scene.step()
          const scriptMs = systemClock.now() - start
          if (gl !== null && timer !== null && query !== null) {
            gl.endQuery(timer.TIME_ELAPSED_EXT)
            waiting.push({ query, frame: i })
          }
          const s = scene.stats()
          taken.push({ scriptMs, gpuMs: Number.NaN, calls: s.calls, triangles: s.triangles })
          await new Promise((resolve) => window.setTimeout(resolve, 33))
          collect()
        }
        for (let tries = 0; tries < 10 && waiting.length > 0; tries += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 50))
          collect()
        }
        for (const item of waiting) gl?.deleteQuery(item.query)
        return { ...summarise(taken), parts: scene.profile() }
      },
      /** Start the guided tour, as the Tour button does. */
      tour: () => {
        document.querySelector<HTMLButtonElement>('#tour')?.click()
      },
    },
  })
}
