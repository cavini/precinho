import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { Client } from 'pg'

/** Rebuilds the ranked feed. Run after a collection. */
async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  await c.query('set statement_timeout = 600000')

  const started = Date.now()
  const r = await c.query('select refresh_feed_cache($1) as cards', [300])
  console.log(`  ${r.rows[0].cards} cards em ${Math.round((Date.now() - started) / 1000)}s`)

  const by = await c.query(`
    select g.slug, count(*) as cards
    from feed_cache f join regions g on g.id = f.region_id
    group by g.slug order by g.slug`)
  for (const row of by.rows) console.log(`    ${row.slug.padEnd(20)} ${row.cards}`)
  await c.end()
}
void main()
