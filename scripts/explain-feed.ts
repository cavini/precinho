import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { Client } from 'pg'

/** Where the feed spends its time, read from the planner rather than guessed. */
async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await client.connect()

  const result = await client.query(`
    explain (analyze, buffers)
    select * from product_feed(
      (select id from regions where slug = 'taubate-sp'),
      array(select id from stores
            where region_id = (select id from regions where slug = 'taubate-sp')
              and active),
      24, 0
    )
  `)

  console.log(result.rows.map((row) => row['QUERY PLAN']).join('\n'))
  await client.end()
}
void main()
