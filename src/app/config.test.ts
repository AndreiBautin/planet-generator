import { describe, expect, it } from 'vitest'

import { parseConfig } from './config'

describe('configuration', () => {
  it('defaults to warn in a build and debug in development', () => {
    expect(parseConfig({}, false).config.logLevel).toBe('warn')
    expect(parseConfig({}, true).config.logLevel).toBe('debug')
  })

  it('takes a known level', () => {
    expect(parseConfig({ VITE_LOG_LEVEL: 'error' }, false)).toEqual({
      config: { logLevel: 'error', serviceWorker: true, assetBase: '/', developer: false },
      warnings: [],
    })
  })

  it('registers the service worker in a build and never in development', () => {
    expect(parseConfig({}, false).config.serviceWorker).toBe(true)
    expect(parseConfig({}, true).config.serviceWorker).toBe(false)
  })

  it('takes the asset base from the build, with its trailing slash, and falls back to the root', () => {
    expect(parseConfig({ BASE_URL: '/planet-generator/' }, false).config.assetBase).toBe(
      '/planet-generator/',
    )
    expect(parseConfig({ BASE_URL: '/planet-generator' }, false).config.assetBase).toBe(
      '/planet-generator/',
    )
    expect(parseConfig({ BASE_URL: 'nonsense' }, false).config.assetBase).toBe('/')
    expect(parseConfig({}, false).config.assetBase).toBe('/')
  })

  /* A typo must never silently enable debug logging in a build. */
  it('falls back with a warning on a value it does not know', () => {
    const result = parseConfig({ VITE_LOG_LEVEL: 'verbose' }, false)
    expect(result.config.logLevel).toBe('warn')
    expect(result.warnings).toHaveLength(1)
  })
})
