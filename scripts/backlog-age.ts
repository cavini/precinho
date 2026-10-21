import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/**
 * Where a pending pair comes from: a product that has been here a while,
 * or one that arrived in the last sweep.
 *
 * The difference decides whether judging is a backlog that settles or a
 * cost that recurs every day, and that is the difference between a
 * pipeline worth automating and one worth rethinking.
 */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const since = process.argv[2] ?? new Date(Date.now() - 86_400_000).toISOString()

  const { count: total } = await client.from('products').select('*', { count: 'exact', head: true })
  const { count: recent } = await client
    .from('products')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since)

  console.log(`  produtos: ${total}`)
  console.log(`  criados desde ${since.slice(0, 16)}: ${recent}`)

  const { count: names } = await client
    .from('product_names')
    .select('*', { count: 'exact', head: true })
    .gte('first_seen', since)
  console.log(`  nomes novos no mesmo período: ${names}`)
}
void main()
