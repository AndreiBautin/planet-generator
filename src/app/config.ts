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
}

export interface ConfigResult {
  readonly config: Config
  readonly warnings: readonly string[]
}

export const DEFAULT_CONFIG: Config = { logLevel: 'warn', serviceWorker: true }

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
  return { config: { logLevel, serviceWorker: !dev && DEFAULT_CONFIG.serviceWorker }, warnings }
}

/** The app's configuration, read once from the build's environment. */
export function readConfig(): ConfigResult {
  return parseConfig(import.meta.env, import.meta.env.DEV)
}
