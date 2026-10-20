/**
 * Folds product rows that are the same product into one.
 *
 * A row without a barcode used to be keyed per store, so the same packaged
 * item existed once per shop — "Sabonete Barra Original Dove 90G" was three
 * products showing one price each, which is a listing, not a comparison.
 * ProductMatcher now merges a packaged item on its name and pack size; this
 * applies that rule to everything already collected.
 *
 * Only rows whose key actually changes are touched: a product with a
 * barcode is already keyed on it, and one with neither barcode nor pack
 * size stays store-local by design.
 *
 * Usage:
 *   npx tsx scripts/merge-duplicate-products.ts           # report only
 *   npx tsx scripts/merge-duplicate-products.ts --apply   # do it
 *
 * Complexity: one pass over the catalogue, O(n) grouping in memory, then
 * one round trip per chunk of groups.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { ProductMatcher } from '@/domain/services/ProductMatcher'
import { Quantity } from '@/domain/value-objects/Quantity'
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

type Row = {
  id: string
  name: string
  brand: string | null
  description: string | null
  image_url: string | null
  gtin14: string | null
  size_amount: number | string | null
  size_unit: string | null
  match_key: string
}

/** Supabase caps a select at 1,000 rows, so the catalogue is read in pages. */
const PAGE = 1_000

/** How many groups to merge per round trip. */
const CHUNK = 400

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const client = createWriteClient(readCollectorEnv())
  const matcher = new ProductMatcher()

  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('products')
      .select('id, name, brand, description, image_url, gtin14, size_amount, size_unit, match_key')
      .order('id')
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE) break
  }

  console.log(`catálogo: ${rows.length} produtos`)

  // Only barcode-less rows with a pack size change key; everything else is
  // already keyed the way the matcher would key it.
  const byKey = new Map<string, Row[]>()
  let eligible = 0

  for (const row of rows) {
    if (row.gtin14) continue

    const size = toQuantity(row)
    if (!size) continue

    eligible += 1
    const key = matcher.keyFor({ ean: null, storeId: '', name: row.name, size })
    byKey.set(key, [...(byKey.get(key) ?? []), row])
  }

  const groups = [...byKey.entries()].filter(([, group]) => group.length > 1)
  const absorbed = groups.reduce((total, [, group]) => total + group.length - 1, 0)

  console.log(`sem código de barras e com tamanho: ${eligible}`)
  console.log(`grupos duplicados: ${groups.length}`)
  console.log(`linhas que somem: ${absorbed}`)

  for (const [key, group] of groups.slice(0, 5)) {
    console.log(`\n  ${key}`)
    for (const row of group) console.log(`     ${row.name.slice(0, 56)}`)
  }

  // Rekeying a row that is already alone still matters: without it the next
  // collection run writes a second row under the new key.
  const lonely = [...byKey.entries()].filter(
    ([key, group]) => group.length === 1 && group[0].match_key !== key,
  )
  console.log(`\nlinhas únicas que só precisam de chave nova: ${lonely.length}`)

  if (!apply) {
    console.log('\n(ensaio — rode com --apply para gravar)')
    return
  }

  const payload = [
    ...groups.map(([key, group]) => {
      const [survivor, ...losers] = [...group].sort(bestFirst)
      return { key, survivor: survivor.id, losers: losers.map((row) => row.id) }
    }),
    ...lonely.map(([key, group]) => ({ key, survivor: group[0].id, losers: [] })),
  ]

  let done = 0
  for (let index = 0; index < payload.length; index += CHUNK) {
    const chunk = payload.slice(index, index + CHUNK)
    const { error } = await client.rpc('merge_product_groups', { p_groups: chunk })
    if (error) throw new Error(error.message)

    done += chunk.length
    console.log(`  ${done}/${payload.length}`)
  }

  console.log(`\npronto: ${groups.length} grupos fundidos, ${absorbed} linhas absorvidas`)
}

/**
 * The row that keeps its identity: the one a shopper would rather read.
 *
 * A photo first, because a row without one renders as a grey box; then a
 * blurb; then a barcode, which makes the survivor merge properly next time.
 * Id last so the choice is the same on every run.
 */
function bestFirst(a: Row, b: Row): number {
  const score = (row: Row) =>
    (row.image_url ? 4 : 0) + (row.description ? 2 : 0) + (row.gtin14 ? 1 : 0)

  return score(b) - score(a) || a.id.localeCompare(b.id)
}

function toQuantity(row: Row): Quantity | null {
  if (row.size_amount === null || !row.size_unit) return null

  const amount = Number(row.size_amount)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return Quantity.of(amount, row.size_unit as Parameters<typeof Quantity.of>[1])
}

void main()
