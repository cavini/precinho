import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { createClient } from '@supabase/supabase-js'

/** Times the read path the website actually uses, with the key it uses. */
async function main(): Promise<void> {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
  const { data: region } = await client
    .from('regions')
    .select('id')
    .eq('slug', 'taubate-sp')
    .single()
  const regionId = (region as { id: string }).id
  const { data: stores } = await client
    .from('stores')
    .select('id')
    .eq('region_id', regionId)
    .eq('active', true)
  const all = (stores as Array<{ id: string }>).map((s) => s.id)

  for (const [label, ids] of [
    ['todas as lojas (cache)', all],
    ['sem uma loja (ao vivo)', all.slice(0, -1)],
  ] as const) {
    for (const attempt of [1, 2]) {
      const started = Date.now()
      const { data, error } = await client.rpc('feed_for', {
        p_region_id: regionId,
        p_store_ids: ids,
        p_limit: 24,
        p_offset: 0,
      })
      const ms = Date.now() - started
      const n = error ? `erro: ${error.message}` : (data as unknown[]).length
      console.log(`  ${label} #${attempt}: ${ms} ms, ${n} cards`)
    }
  }
}
void main()
