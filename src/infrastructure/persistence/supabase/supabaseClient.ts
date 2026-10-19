import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppEnv, CollectorEnv } from '@/infrastructure/config/env'

/**
 * Read client for the website.
 *
 * The anon key is subject to row level security, which the migration sets to
 * select-only on the catalogue tables. Even if this key leaked it could not
 * write a price.
 *
 * No session persistence: every request is anonymous, there is no login, and
 * a server-side client that tries to persist a session misbehaves across
 * serverless invocations.
 */
export function createReadClient(env: AppEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Write client for the collector only.
 *
 * The service role key bypasses row level security, so it lives in the
 * collector's secrets and never in anything the browser can reach.
 */
export function createWriteClient(env: CollectorEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
