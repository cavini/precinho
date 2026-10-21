import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/**
 * The same product in two shops, as collected.
 *
 * Reads what is in the database rather than what an API said, which is
 * the only way to know the regional data actually landed regional.
 */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const [slugA, slugB] = process.argv.slice(2)

  const ids: Record<string, string> = {}
  for (const slug of [slugA, slugB]) {
    const { data } = await client.from('stores').select('id').eq('slug', slug).single()
    ids[slug] = (data as { id: string }).id
  }

  const latest = async (storeId: string) => {
    const prices = new Map<string, number>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from('offers')
        .select('product_id, price_cents, collected_at')
        .eq('store_id', storeId)
        .order('collected_at', { ascending: false })
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      const page = (data ?? []) as Array<{ product_id: string; price_cents: number }>
      for (const row of page)
        if (!prices.has(row.product_id)) prices.set(row.product_id, row.price_cents)
      if (page.length < 1000) break
    }
    return prices
  }

  const a = await latest(ids[slugA])
  const b = await latest(ids[slugB])

  const shared = [...a.keys()].filter((id) => b.has(id))
  const differing = shared.filter((id) => a.get(id) !== b.get(id))

  console.log(`  ${slugA}: ${a.size} produtos | ${slugB}: ${b.size} produtos`)
  console.log(`  em comum: ${shared.length}`)
  console.log(`  com preço diferente: ${differing.length}`)
  console.log(
    `  só em ${slugA}: ${a.size - shared.length} | só em ${slugB}: ${b.size - shared.length}`,
  )

  for (const id of differing.slice(0, 6)) {
    const { data } = await client.from('products').select('name').eq('id', id).single()
    const name = (data as { name: string }).name.slice(0, 44)
    console.log(
      `     ${name.padEnd(46)} ${(a.get(id)! / 100).toFixed(2)} x ${(b.get(id)! / 100).toFixed(2)}`,
    )
  }
}
void main()
