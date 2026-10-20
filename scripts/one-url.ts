import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const { data: store } = await client
    .from('stores')
    .select('id')
    .eq('slug', process.argv[2])
    .single()
  const { data } = await client
    .from('offers')
    .select('url')
    .eq('store_id', (store as { id: string }).id)
    .order('collected_at', { ascending: false })
    .limit(1)
  console.log((data as Array<{ url: string }>)[0]?.url ?? '')
}
void main()
