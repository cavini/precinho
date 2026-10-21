import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const key = process.argv[2]

  const { data: alias } = await client
    .from('product_aliases')
    .select('match_key, product_id')
    .eq('match_key', key)
    .maybeSingle()

  if (!alias) {
    console.log(`  sem apelido para ${key}`)
    return
  }

  const { data: product } = await client
    .from('products')
    .select('name, match_key, gtin14')
    .eq('id', (alias as { product_id: string }).product_id)
    .single()

  console.log(`  chave antiga: ${key}`)
  console.log(`  aponta para:  ${(product as { name: string }).name}`)
  console.log(`  chave viva:   ${(product as { match_key: string }).match_key}`)
}
void main()
