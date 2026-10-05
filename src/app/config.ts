import { LOG_LEVELS, type LogLevel } from '@/shared/logger'

/**
 * Configuration, parsed totally. A bad value degrades to a documented
 * default and a warning — never a crash at startup, and never a silent
 * switch into the wrong mode. Every variable is listed in `.env.example`.
 *
 * Vite exposes only `VITE_`-prefixed variables to the browser, and
 * everything it exposes is public: nothing here may hold a credential.
 */
export interface Config {
  readonly logLevel: LogLevel
  /**
   * Register the service worker. Off in development: a worker caching the
   * dev server's modules serves yesterday's code to today's edit.
   */
  readonly serviceWorker: boolean
  /** Where the build's public files are served from, with its trailing slash: `/` or `/planet-generator/`. */
  readonly assetBase: string
  /** A development build: the tools that are never shipped, such as the frame recorder, may run. */
  readonly developer: boolean
  /** The commit this build was made from, shortened; `dev` when there is none. */
  readonly build: string
}

export interface ConfigResult {
  readonly config: Config
  readonly warnings: readonly string[]
}

export const DEFAULT_CONFIG: Config = {
  logLevel: 'warn',
  serviceWorker: true,
  assetBase: '/',
  developer: false,
  build: 'dev',
}

export function parseConfig(env: Readonly<Record<string, unknown>>, dev: boolean): ConfigResult {
  const warnings: string[] = []
  const raw = env.VITE_LOG_LEVEL
  let logLevel: LogLevel = dev ? 'debug' : DEFAULT_CONFIG.logLevel
  if (raw !== undefined && raw !== '') {
    if (typeof raw === 'string' && (LOG_LEVELS as readonly string[]).includes(raw)) {
      logLevel = raw as LogLevel
    } else {
      warnings.push(`VITE_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}; using ${logLevel}.`)
    }
  }
  const base = env.BASE_URL
  const assetBase =
    typeof base === 'string' && base.startsWith('/')
      ? base.endsWith('/')
        ? base
        : `${base}/`
      : DEFAULT_CONFIG.assetBase
  return {
    config: {
      logLevel,
      serviceWorker: !dev && DEFAULT_CONFIG.serviceWorker,
      assetBase,
      developer: dev,
      build:
        typeof env.VITE_BUILD === 'string' && /^[0-9a-f]{7,40}$/.test(env.VITE_BUILD)
          ? env.VITE_BUILD.slice(0, 7)
          : DEFAULT_CONFIG.build,
    },
    warnings,
  }
}

/** The app's configuration, read once from the build's environment. */
export function readConfig(): ConfigResult {
  return parseConfig(import.meta.env, import.meta.env.DEV)
}
