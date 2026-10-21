/**
 * Rebuilds the aliases for merges applied before aliases existed.
 *
 * product_merges recorded the absorbed row's name and barcode but not its
 * match key, so the keys of the first 5,160 folds were lost with the rows.
 * They can be reconstructed: a barcode gives the key directly, and without
 * one the key is the name and the pack size — which is necessarily the
 * survivor's size, because the matcher refuses a pair whose sizes differ.
 *
 * Idempotent: the alias table takes the same row twice without complaint.
 *
 * Complexity: one pass over the merge log, O(1) per row.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { ProductMatcher } from '@/domain/services/ProductMatcher'
import { Ean } from '@/domain/value-objects/Ean'
import { Quantity } from '@/domain/value-objects/Quantity'
import { readCollectorEnv } from '@/infrastructure/config/env'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

const PAGE = 1_000

type MergeRow = {
  survivor_id: string
  absorbed_name: string
  absorbed_gtin14: string | null
  absorbed_match_key: string | null
}

async function main(): Promise<void> {
  const client = createWriteClient(readCollectorEnv())
  const matcher = new ProductMatcher()

  const merges: MergeRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('product_merges')
      .select('survivor_id, absorbed_name, absorbed_gtin14, absorbed_match_key')
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const page = (data ?? []) as MergeRow[]
    merges.push(...page)
    if (page.length < PAGE) break
  }

  const survivorIds = [...new Set(merges.map((row) => row.survivor_id))]
  const sizes = new Map<string, Quantity | null>()

  // Two hundred at a time, and the error is read. A thousand uuids in an
  // `in` clause makes a URL long enough to be rejected, and the first
  // version of this script ignored the error and silently rebuilt 212
  // aliases out of 5,160.
  const LOOKUP = 200

  for (let index = 0; index < survivorIds.length; index += LOOKUP) {
    const { data, error } = await client
      .from('products')
      .select('id, size_amount, size_unit')
      .in('id', survivorIds.slice(index, index + LOOKUP))

    if (error) throw new Error(`lendo sobreviventes: ${error.message}`)

    for (const row of (data ?? []) as Array<{
      id: string
      size_amount: number | string | null
      size_unit: string | null
    }>) {
      sizes.set(row.id, toQuantity(row.size_amount, row.size_unit))
    }
  }

  const aliases: Array<{ match_key: string; product_id: string }> = []
  let unreconstructable = 0

  for (const row of merges) {
    if (row.absorbed_match_key) {
      aliases.push({ match_key: row.absorbed_match_key, product_id: row.survivor_id })
      continue
    }

    const key = matcher.keyFor({
      ean: Ean.tryParse(row.absorbed_gtin14),
      // Only reached for a product with neither barcode nor size, where the
      // key was store-local and cannot be rebuilt from here.
      storeId: '',
      name: row.absorbed_name,
      size: sizes.get(row.survivor_id) ?? null,
    })

    if (key.startsWith('store:')) {
      unreconstructable += 1
      continue
    }

    aliases.push({ match_key: key, product_id: row.survivor_id })
  }

  console.log(`fusões registradas: ${merges.length}`)
  console.log(`apelidos reconstruídos: ${aliases.length}`)
  console.log(`sem como reconstruir: ${unreconstructable}`)

  for (let index = 0; index < aliases.length; index += 500) {
    const { error } = await client
      .from('product_aliases')
      .upsert(aliases.slice(index, index + 500), { onConflict: 'match_key' })
    if (error) throw new Error(error.message)
  }

  const { count } = await client.from('product_aliases').select('*', { count: 'exact', head: true })
  console.log(`apelidos na tabela: ${count}`)
}

function toQuantity(amount: number | string | null, unit: string | null): Quantity | null {
  if (amount === null || !unit) return null

  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null

  return Quantity.of(value, unit as Parameters<typeof Quantity.of>[1])
}

void main()
