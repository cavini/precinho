import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const { data } = await client
    .from('product_merges')
    .select('survivor_id, absorbed_name, absorbed_gtin14, absorbed_match_key, decided_by, reason')
    .ilike('absorbed_name', '%Vegetal Odor de Rosas Phebo%')
  console.log(JSON.stringify(data, null, 1).slice(0, 700))

  const row = (data ?? [])[0] as { survivor_id: string } | undefined
  if (!row) return
  const { data: p } = await client
    .from('products')
    .select('id, name, size_amount, size_unit')
    .eq('id', row.survivor_id)
    .maybeSingle()
  console.log('sobrevivente:', JSON.stringify(p))
}
void main()
