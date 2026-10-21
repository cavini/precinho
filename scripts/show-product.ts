import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const id = process.argv[2]

  const { data: product } = await client
    .from('products')
    .select('id, name, brand, gtin14, size_amount, size_unit, match_key, image_url')
    .eq('id', id)
    .single()
  console.log('produto:', JSON.stringify(product, null, 2))

  const { data: offers } = await client
    .from('offers')
    .select('store_id, price_cents, in_stock, collected_at, url, stores(slug, region_id)')
    .eq('product_id', id)
    .order('collected_at', { ascending: false })
    .limit(10)
  console.log('ofertas:')
  for (const o of (offers ?? []) as Array<Record<string, unknown>>) {
    const store = o.stores as { slug?: string } | null
    console.log(
      `  ${store?.slug ?? o.store_id}  ${o.price_cents}  estoque=${o.in_stock}  ${o.collected_at}`,
    )
  }
}
void main()
