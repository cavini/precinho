import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { Client } from 'pg'

/** What the first screen now offers, read from the built ranking. */
async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  const r = await c.query(
    `
    select f.position, f.name, f.spread_cents,
           (select min((o ->> 'price_cents')::integer) from jsonb_array_elements(f.offers) o) as lo,
           jsonb_array_length(f.offers) as lojas
    from feed_cache f join regions g on g.id = f.region_id
    where g.slug = $1 order by f.position limit 10`,
    [process.argv[2] ?? 'sp-2'],
  )

  for (const row of r.rows) {
    const pct = Math.round((100 * row.spread_cents) / row.lo)
    console.log(
      `  ${String(row.position).padStart(2)}. ${row.name.slice(0, 44).padEnd(46)} ` +
        `R$ ${(row.lo / 100).toFixed(2).padStart(6)} → economiza R$ ${(row.spread_cents / 100)
          .toFixed(2)
          .padStart(6)} (${String(pct).padStart(3)}%) em ${row.lojas} lojas`,
    )
  }
  await c.end()
}
void main()
