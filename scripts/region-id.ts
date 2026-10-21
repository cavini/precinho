import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const { data } = await client
    .from('regions')
    .select('id, slug')
    .eq('slug', process.argv[2])
    .single()
  console.log((data as { id: string }).id)
}
void main()
