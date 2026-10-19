/**
 * Ad-hoc read-only look at what the collector has actually stored.
 *
 * Lives in the repo rather than in a scratch file because every time I
 * wanted it this session I rewrote it from memory.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())

  const { data: stores } = await client
    .from('stores')
    .select('id, slug, active, sweep_mode, daily_request_budget, regions(slug)')
    .order('slug')

  console.log('stores:')
  for (const store of (stores ?? []) as any[]) {
    const { count } = await client
      .from('offers')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.id)

    console.log(
      `  ${store.active ? '✓' : '·'} ${store.slug.padEnd(14)} ` +
        `region=${(store.regions?.slug ?? 'NONE').padEnd(12)} ` +
        `mode=${String(store.sweep_mode).padEnd(10)} offers=${count ?? 0}`,
    )
  }

  const { data: regions } = await client.from('regions').select('slug, name, probe_cep')
  console.log('\nregions:')
  for (const region of (regions ?? []) as any[]) {
    console.log(`  ${region.slug.padEnd(14)} ${region.probe_cep}  ${region.name}`)
  }
}

void main()
