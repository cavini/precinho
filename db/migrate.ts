/**
 * Applies the SQL migrations in order.
 *
 * Supabase's REST interface cannot run DDL, so this connects to Postgres
 * directly. Every migration is written to be idempotent — `if not exists`,
 * `or replace`, `on conflict do nothing` — so re-running the whole folder is
 * safe and is the normal way to use this.
 *
 * Usage: `npm run migrate` (migrations only) or `npm run migrate -- --seed`.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'

loadEnv({ path: '.env.local' })
loadEnv()

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) {
    console.error(
      'SUPABASE_DB_URL is not set. Supabase shows it under ' +
        'Settings > Database > Connection string > URI.',
    )
    process.exitCode = 1
    return
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    // Numeric prefixes, so lexicographic order is apply order.
    .sort()

  const client = new Client({ connectionString })
  await client.connect()

  try {
    for (const file of files) {
      process.stdout.write(`  ${file} ... `)
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      console.log('ok')
    }

    if (process.argv.includes('--seed')) {
      process.stdout.write('  seed.sql ... ')
      await client.query(readFileSync(join(import.meta.dirname, 'seed.sql'), 'utf8'))
      console.log('ok')
    }
  } finally {
    await client.end()
  }
}

void main()
