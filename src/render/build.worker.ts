import type { WorkRequest } from './build-protocol'
import { answer, transferables } from './work'

/**
 * Makes planets off the main thread, so the page keeps drawing — and the
 * birth animation keeps playing — while ground is sampled. The arrays are
 * transferred rather than copied: the worker gives them up on sending.
 */
self.onmessage = (event: MessageEvent<WorkRequest>) => {
  const result = answer(event.data)
  self.postMessage(result, { transfer: transferables(result) })
}
