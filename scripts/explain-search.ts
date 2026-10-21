import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { Client } from 'pg'

/**
 * Where a search spends its time, read from the planner rather than
 * guessed. The counterpart to explain-feed, and the tool that found the
 * nested loop re-running the price aggregate once per candidate.
 *
 * Usage: npx tsx scripts/explain-search.ts "leite condensado"
 */
async function main(): Promise<void> {
  const tokens = (process.argv[2] ?? 'sabonete').toLowerCase().split(/\s+/)

  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await client.connect()

  // The region the app actually serves is the one with active shops;
  // pointing this at any other returns no rows and times nothing.
  const region = await client.query(
    `select r.id, r.slug from regions r
     join stores s on s.region_id = r.id and s.active
     group by r.id, r.slug order by count(*) desc limit 1`,
  )
  if (region.rowCount === 0) throw new Error('no region has active stores')
  const { id, slug } = region.rows[0]
  console.log(`region ${slug}, tokens ${JSON.stringify(tokens)}\n`)

  const result = await client.query(
    `explain (analyze, buffers)
     select * from search_products(
       $1::text[], $2::uuid,
       array(select id from stores where region_id = $2::uuid and active),
       24, 0
     )`,
    [tokens, id],
  )

  console.log(result.rows.map((row) => row['QUERY PLAN']).join('\n'))
  await client.end()
}
void main()
