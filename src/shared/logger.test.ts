import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger, setLogLevel } from './logger'

/**
 * The one console sink. What would be silently wrong: a level that lets
 * debug noise through in a build, or one that swallows an error.
 */
describe('logger', () => {
  const calls = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  }

  afterEach(() => {
    for (const spy of Object.values(calls)) spy.mockClear()
    setLogLevel('info')
  })

  const fire = (): void => {
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e', { code: 3 })
  }

  it('drops what is under the level and keeps what is at or over it', () => {
    setLogLevel('warn')
    fire()
    expect(calls.debug).not.toHaveBeenCalled()
    expect(calls.info).not.toHaveBeenCalled()
    expect(calls.warn).toHaveBeenCalledOnce()
    expect(calls.error).toHaveBeenCalledOnce()
  })

  it('sends each level to its own console method, as one structured line', () => {
    setLogLevel('debug')
    fire()
    expect(calls.debug).toHaveBeenCalledWith({ event: 'd' })
    expect(calls.info).toHaveBeenCalledWith({ event: 'i' })
    expect(calls.warn).toHaveBeenCalledWith({ event: 'w' })
    expect(calls.error).toHaveBeenCalledWith({ event: 'e', code: 3 })
  })

  it('says nothing at all when silent, errors included', () => {
    setLogLevel('silent')
    fire()
    for (const spy of Object.values(calls)) expect(spy).not.toHaveBeenCalled()
  })
})
