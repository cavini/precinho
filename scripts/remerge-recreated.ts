import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/**
 * Folds back the rows a failed lookup let a collection recreate.
 *
 * product_names already says which product a name belongs to. Any row
 * whose own name points at a *different* product is a row that should
 * never have been created, so it goes back where the name says it
 * belongs.
 *
 * Complexity: one pass over the name table, then one merge call per chunk.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const client = createWriteClient(readCollectorEnv())

  const names: Array<{ name: string; product_id: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('product_names')
      .select('name, product_id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as Array<{ name: string; product_id: string }>
    names.push(...page)
    if (page.length < 1000) break
  }
  const owner = new Map(names.map((row) => [row.name, row.product_id]))

  const products: Array<{ id: string; name: string; match_key: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('products')
      .select('id, name, match_key')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as Array<{ id: string; name: string; match_key: string }>
    products.push(...page)
    if (page.length < 1000) break
  }

  const strays = products.filter((p) => {
    const belongsTo = owner.get(p.name)
    return belongsTo !== undefined && belongsTo !== p.id
  })

  console.log(`produtos: ${products.length}`)
  console.log(`recriados indevidamente: ${strays.length}`)
  for (const stray of strays.slice(0, 6)) console.log(`   ${stray.name.slice(0, 64)}`)

  if (!apply || strays.length === 0) {
    if (!apply) console.log('\n(ensaio — use --apply)')
    return
  }

  const groups = strays.map((stray) => ({
    key: '',
    survivor: owner.get(stray.name)!,
    losers: [stray.id],
    decided_by: 'recriado por busca falha, devolvido pelo nome',
  }))

  // The survivor keeps the key it already has. Read from the full product
  // list rather than re-queried: slicing a lookup to the first 500 was how
  // a backfill silently did a twentieth of its job earlier today.
  const keys = new Map(products.map((p) => [p.id, p.match_key]))
  for (const group of groups) group.key = keys.get(group.survivor) ?? ''

  // These rows should never have existed, so nothing of theirs is worth
  // inheriting — and a barcode that already belongs to a third product
  // fails the unique index and takes the whole batch down with it.
  for (let index = 0; index < strays.length; index += 200) {
    const { error } = await client
      .from('products')
      .update({ gtin14: null })
      .in(
        'id',
        strays.slice(index, index + 200).map((stray) => stray.id),
      )
    if (error) throw new Error(`limpando códigos de barras: ${error.message}`)
  }

  const usable = groups.filter((group) => group.key !== '')
  for (let index = 0; index < usable.length; index += 200) {
    const { error } = await client.rpc('merge_product_groups', {
      p_groups: usable.slice(index, index + 200),
    })
    if (error) throw new Error(error.message)
  }
  console.log(`devolvidos: ${usable.length}`)
}
void main()
