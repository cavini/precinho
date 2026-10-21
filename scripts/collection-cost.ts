import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/** What a nightly sweep costs, by region, before deciding what to drop. */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const { data } = await client
    .from('stores')
    .select('slug, active, sweep_mode, min_interval_ms, regions(slug)')
    .eq('active', true)

  const rows = (data ?? []) as unknown as Array<{
    slug: string
    sweep_mode: string
    min_interval_ms: number | null
    regions: { slug: string } | null
  }>

  const byRegion = new Map<string, { stores: number; seconds: number }>()
  for (const row of rows) {
    const region = row.regions?.slug ?? '—'
    const gap = (row.min_interval_ms ?? 1200) / 1000
    // 422 basket terms, or about 190 category pages for a browsed shop.
    const requests = row.sweep_mode === 'categories' ? 190 : 422
    const current = byRegion.get(region) ?? { stores: 0, seconds: 0 }
    byRegion.set(region, {
      stores: current.stores + 1,
      seconds: current.seconds + requests * gap,
    })
  }

  let total = 0
  for (const [region, v] of [...byRegion].sort()) {
    console.log(
      `  ${region.padEnd(20)} ${String(v.stores).padStart(2)} lojas  ` +
        `~${Math.round(v.seconds / 60)} min de requisições`,
    )
    total += v.seconds
  }
  console.log(`  ${'total'.padEnd(20)} ${rows.length} lojas  ~${Math.round(total / 60)} min`)
}
void main()
