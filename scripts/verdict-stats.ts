import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/** Where the judging stands, and what the merges have done so far. */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())

  const { count: judged } = await client
    .from('product_equivalences')
    .select('*', { count: 'exact', head: true })
  const { count: same } = await client
    .from('product_equivalences')
    .select('*', { count: 'exact', head: true })
    .eq('same', true)
  const { count: merges } = await client
    .from('product_merges')
    .select('*', { count: 'exact', head: true })
  const { count: products } = await client
    .from('products')
    .select('*', { count: 'exact', head: true })

  console.log(`  julgados: ${judged}  (iguais: ${same})`)
  console.log(`  fusões registradas: ${merges}`)
  console.log(`  produtos no catálogo: ${products}`)
}
void main()
