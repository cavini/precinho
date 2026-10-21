import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { Client } from 'pg'
async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  const r = await c.query(`
    select count(*) as ofertas,
           count(distinct product_id) as produtos,
           pg_size_pretty(pg_total_relation_size('offers')) as tamanho
    from offers`)
  console.log(r.rows[0])
  const i = await c.query(`
    select indexname, indexdef from pg_indexes
    where tablename = 'offers' order by indexname`)
  for (const row of i.rows)
    console.log(' ', row.indexname, '→', row.indexdef.split('USING')[1]?.trim())
  await c.end()
}
void main()
