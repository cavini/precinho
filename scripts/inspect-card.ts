import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { Client } from 'pg'

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  const r = await c.query(`
    select f.position, f.name,
           (select string_agg(s.slug || ' ' || to_char((o ->> 'price_cents')::integer / 100.0, 'FM999.00'), '  '
                   order by (o ->> 'price_cents')::integer)
            from jsonb_array_elements(f.offers) o
            join stores s on s.id = (o ->> 'store_id')::uuid) as precos
    from feed_cache f join regions g on g.id = f.region_id
    where g.slug = 'sp-2' and f.position <= 5 order by f.position`)
  for (const row of r.rows) {
    console.log(`\n  ${row.position}. ${row.name.slice(0, 54)}`)
    console.log(`     ${row.precos}`)
  }
  await c.end()
}
void main()
