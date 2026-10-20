import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  for (const host of process.argv.slice(2)) {
    const { count } = await client
      .from('offers')
      .select('*', { count: 'exact', head: true })
      .like('url', `%${host}%`)
    console.log(`  ${host.padEnd(42)} ${count ?? 0} ofertas`)
  }
}
void main()
