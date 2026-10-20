import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/** Every product row matching a phrase, with who sells it. */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const tokens = process.argv.slice(2)

  let query = client
    .from('products')
    .select('id, name, brand, gtin14, size_amount, size_unit, match_key')
    .limit(40)
  for (const token of tokens) query = query.ilike('search_text', `%${token}%`)

  const rows = (await query).data as Array<Record<string, unknown>>

  for (const row of rows ?? []) {
    const { data: offers } = await client
      .from('offers')
      .select('price_cents, stores(slug)')
      .eq('product_id', row.id as string)
      .order('collected_at', { ascending: false })
      .limit(8)

    const shops = [
      ...new Set(
        ((offers ?? []) as unknown as Array<{ stores: { slug: string } | null }>).map(
          (o) => o.stores?.slug ?? '?',
        ),
      ),
    ]

    console.log(`\n  ${row.name}`)
    console.log(
      `     marca=${row.brand ?? '—'}  gtin=${row.gtin14 ?? '—'}  ` +
        `tam=${row.size_amount}${row.size_unit}`,
    )
    console.log(`     lojas: ${shops.join(', ')}`)
    console.log(`     key: ${String(row.match_key).slice(0, 70)}`)
  }
}
void main()
