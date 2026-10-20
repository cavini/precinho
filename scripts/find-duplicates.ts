import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/**
 * Products that look like the same thing stored twice.
 *
 * The comparator's whole job is one row per product with several prices
 * under it; a product split across two rows shows two prices in two places
 * and compares nothing.
 */
async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const token = process.argv[2] ?? 'dove'

  const { data } = await client
    .from('products')
    .select('id, name, brand, gtin14, size_amount, size_unit, match_key, image_url')
    .ilike('name', `%${token}%`)
    .limit(60)

  const rows = (data ?? []) as Array<{
    id: string
    name: string
    gtin14: string | null
    size_amount: number | null
    size_unit: string | null
    match_key: string
  }>

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.name.toLowerCase().trim()}|${row.size_amount}${row.size_unit}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  let duplicated = 0
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    duplicated += 1
    if (duplicated > 4) continue
    console.log(`\n"${key}" aparece ${group.length}x:`)
    for (const row of group) {
      console.log(
        `   gtin=${row.gtin14 ?? '—'.padEnd(14)}  match_key=${row.match_key.slice(0, 64)}`,
      )
    }
  }

  console.log(`\ngrupos com nome+tamanho idênticos e mais de uma linha: ${duplicated}`)
  console.log(`linhas sem código de barras: ${rows.filter((r) => !r.gtin14).length}/${rows.length}`)
}
void main()
