/**
 * Environment, read and validated in one place.
 *
 * Every read goes through here so a missing variable fails at startup with a
 * sentence that says which one, rather than surfacing later as an
 * unauthenticated request against undefined.
 *
 * None of these are NEXT_PUBLIC: every database read happens in a server
 * component or route handler, so no key needs to reach the browser.
 */

export type AppEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export type CollectorEnv = AppEnv & {
  /** Write access. Bypasses row level security, so it never leaves the collector. */
  supabaseServiceRoleKey: string
}

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `${name} is not set. Copy .env.example to .env.local and fill it in; ` +
        'the Supabase values are under Project Settings > API.',
    )
    this.name = 'MissingEnvError'
  }
}

function required(name: string, source: NodeJS.ProcessEnv): string {
  const value = source[name]
  if (!value || value.trim() === '') throw new MissingEnvError(name)
  return value.trim()
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error'])

function logLevel(source: NodeJS.ProcessEnv): AppEnv['logLevel'] {
  const value = (source.LOG_LEVEL ?? 'info').trim()
  return LOG_LEVELS.has(value) ? (value as AppEnv['logLevel']) : 'info'
}

/** What the website needs: read-only access. */
export function readAppEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    supabaseUrl: required('SUPABASE_URL', source),
    supabaseAnonKey: required('SUPABASE_ANON_KEY', source),
    logLevel: logLevel(source),
  }
}

/** What the collector needs: write access as well. */
export function readCollectorEnv(source: NodeJS.ProcessEnv = process.env): CollectorEnv {
  return {
    ...readAppEnv(source),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', source),
  }
}
