/**
 * The one place the app writes to the console.
 *
 * Structured and level-filtered, and **typed to carry event names and
 * scalars only** — which is what makes it safe to leave on. Every other
 * `console` call is a lint error, so the level filter cannot be bypassed.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Scalars only — the type is the enforcement. */
export type LogFields = Readonly<Record<string, string | number | boolean | null | undefined>>

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

let level: LogLevel = 'info'

export function setLogLevel(next: LogLevel): void {
  level = next
}

function emit(at: Exclude<LogLevel, 'silent'>, event: string, fields?: LogFields): void {
  if (SEVERITY[at] < SEVERITY[level]) return
  const line = fields === undefined ? { event } : { event, ...fields }
  switch (at) {
    case 'debug':
      console.debug(line)
      return
    case 'info':
      console.info(line)
      return
    case 'warn':
      console.warn(line)
      return
    case 'error':
      console.error(line)
      return
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => {
    emit('debug', event, fields)
  },
  info: (event: string, fields?: LogFields) => {
    emit('info', event, fields)
  },
  warn: (event: string, fields?: LogFields) => {
    emit('warn', event, fields)
  },
  error: (event: string, fields?: LogFields) => {
    emit('error', event, fields)
  },
}
