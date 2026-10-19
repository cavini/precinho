import { describe, expect, it } from 'vitest'
import { MissingEnvError, readAppEnv, readCollectorEnv } from './env'

const COMPLETE = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

describe('readAppEnv', () => {
  it('reads what the site needs', () => {
    expect(readAppEnv(COMPLETE)).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'anon-key',
      logLevel: 'info',
    })
  })

  it('trims surrounding whitespace, which a pasted key often carries', () => {
    expect(readAppEnv({ ...COMPLETE, SUPABASE_ANON_KEY: '  anon-key \n' }).supabaseAnonKey).toBe(
      'anon-key',
    )
  })

  it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY'])('fails loudly when %s is missing', (name) => {
    const incomplete = { ...COMPLETE, [name]: undefined }
    expect(() => readAppEnv(incomplete)).toThrow(MissingEnvError)
    // The message has to say which one, and where to find it.
    expect(() => readAppEnv(incomplete)).toThrow(new RegExp(name))
  })

  it('treats an empty value as missing', () => {
    expect(() => readAppEnv({ ...COMPLETE, SUPABASE_URL: '   ' })).toThrow(MissingEnvError)
  })

  describe('log level', () => {
    it.each(['debug', 'info', 'warn', 'error'] as const)('accepts %s', (level) => {
      expect(readAppEnv({ ...COMPLETE, LOG_LEVEL: level }).logLevel).toBe(level)
    })

    it('falls back to info for a value it does not know', () => {
      // A typo in a log level should not stop the site from booting.
      expect(readAppEnv({ ...COMPLETE, LOG_LEVEL: 'verbose' }).logLevel).toBe('info')
    })
  })
})

describe('readCollectorEnv', () => {
  it('also requires the service role key', () => {
    expect(readCollectorEnv(COMPLETE).supabaseServiceRoleKey).toBe('service-key')
    expect(() => readCollectorEnv({ ...COMPLETE, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
  })

  it('does not require it for the site, which only reads', () => {
    expect(() => readAppEnv({ ...COMPLETE, SUPABASE_SERVICE_ROLE_KEY: undefined })).not.toThrow()
  })
})
