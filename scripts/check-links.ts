import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/**
 * Follows a handful of real "ver na loja" links per store.
 *
 * The link is the whole point of a price comparison, and a dead one is
 * invisible from the code: Oba's pointed at a domain with no DNS record
 * for weeks because nobody clicked one.
 */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const slug = process.argv[2]
  const sample = Number(process.argv[3] ?? 4)

  const { data: store } = await client.from('stores').select('id').eq('slug', slug).single()
  const { data: offers } = await client
    .from('offers')
    .select('url')
    .eq('store_id', (store as { id: string }).id)
    .order('collected_at', { ascending: false })
    .limit(sample)

  for (const { url } of (offers ?? []) as Array<{ url: string }>) {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0' },
      signal: AbortSignal.timeout(25_000),
    }).catch(() => null)

    console.log(`  ${response?.status ?? 'sem resposta'}  ${url.slice(0, 84)}`)
  }
}
void main()
