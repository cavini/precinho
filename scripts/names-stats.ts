import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const { count: names } = await client
    .from('product_names')
    .select('*', { count: 'exact', head: true })
  const { count: aliases } = await client
    .from('product_aliases')
    .select('*', { count: 'exact', head: true })
  const { count: products } = await client
    .from('products')
    .select('*', { count: 'exact', head: true })

  console.log(`  nomes registrados: ${names}`)
  console.log(`  apelidos de chave: ${aliases}`)
  console.log(`  produtos: ${products}`)

  const { data } = await client
    .from('product_names')
    .select('name, product_id')
    .ilike('name', '%Odor de Rosas Phebo%')
  console.log('\n  nomes do sabonete phebo:')
  for (const row of (data ?? []) as Array<{ name: string; product_id: string }>) {
    console.log(`    ${row.product_id.slice(0, 8)}  ${row.name}`)
  }
}
void main()
