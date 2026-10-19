/**
 * Applies the SQL migrations in order.
 *
 * Supabase's REST interface cannot run DDL, so this connects to Postgres
 * directly.
 *
 * Each file runs once and is recorded. Idempotent statements are not enough
 * on their own: 0004 recreates a check constraint listing the platforms
 * known at the time, so replaying it after 0005 added another one fails
 * against rows that are perfectly valid. Order matters, and "already done"
 * has to be a fact rather than a hope.
 *
 * Each file runs inside its own transaction, so a failure leaves the
 * schema where it was rather than half-changed.
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
    await client.query(`
      create table if not exists schema_migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      )
    `)

    const { rows } = await client.query<{ filename: string }>(
      'select filename from schema_migrations',
    )
    const applied = new Set(rows.map((row) => row.filename))

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ${file} ... already applied`)
        continue
      }

      process.stdout.write(`  ${file} ... `)
      await client.query('begin')
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
        await client.query('insert into schema_migrations (filename) values ($1)', [file])
        await client.query('commit')
        console.log('ok')
      } catch (error) {
        await client.query('rollback')
        console.log('failed')
        throw error
      }
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
