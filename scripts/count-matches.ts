import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const token = process.argv[2] ?? 'sabonete'
  const regionSlug = process.argv[3] ?? 'sp-2'

  const { data: region } = await client.from('regions').select('id').eq('slug', regionSlug).single()
  const { data: stores } = await client
    .from('stores')
    .select('id')
    .eq('region_id', (region as { id: string }).id)
    .eq('active', true)

  const ids = (stores as Array<{ id: string }>).map((s) => s.id)

  const { count: products } = await client
    .from('products')
    .select('*', { count: 'exact', head: true })
    .like('search_text', `%${token}%`)

  const { data: rows } = await client.rpc('search_products', {
    p_tokens: [token],
    p_region_id: (region as { id: string }).id,
    p_store_ids: ids,
    p_limit: 24,
    p_offset: Number(process.argv[4] ?? 0),
  })

  console.log(`"${token}" em ${regionSlug}:`)
  console.log(`  produtos no catálogo inteiro: ${products}`)
  console.log(`  offset ${process.argv[4] ?? 0}, limite 24 -> ${(rows as unknown[]).length} linhas`)
  const withStock = (rows as Array<{ available_store_count: number }>).filter(
    (r) => r.available_store_count > 0,
  ).length
  console.log(`  destes, com estoque nas lojas da praça: ${withStock}`)
}
void main()
