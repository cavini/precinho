/**
 * Prunes offers, and proves the prune changed nothing a reader can see.
 *
 * `prune_offers` (0065) deletes two kinds of row: everything belonging to a
 * store no longer collected, and history past the window that some newer row
 * has already superseded. What it must never touch is the most recent offer
 * for a (product, store) pair, because that single row is what every reader
 * takes — there is no staleness filter anywhere, so losing it does not show
 * a stale price, it removes the store from the product's page.
 *
 * That property is checkable rather than arguable, so this script checks it:
 * it fingerprints the set of current offers before and after and refuses to
 * call the run a success unless the two match exactly. On production data
 * that is a stronger statement than a unit test against a fixture.
 *
 * `--vacuum` additionally runs `vacuum full` on offers. A plain delete only
 * marks space reusable inside the table; the bytes go back to the operating
 * system — and to the figure Supabase measures the project against — only on
 * a rewrite. It takes an exclusive lock for the duration, so searches block
 * while it runs.
 *
 * Usage: npm run prune
 *        npm run prune -- --vacuum
 *        npm run prune -- --keep '7 days'
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { Client } from 'pg'

/** Long enough for a rewrite of the whole table on a Micro instance. */
const STATEMENT_TIMEOUT_MS = 20 * 60 * 1000

/**
 * The set of offers a reader can reach, as one comparable value.
 *
 * One row per (product, store) for the stores the site shows, which is
 * exactly what `search_products` and `product_offers` select. Ordering by
 * (product_id, store_id, collected_at desc) is the order
 * `offers_current_idx` already stores, so this reads the index rather than
 * sorting the table.
 */
const FINGERPRINT = `
  with current_offer as (
    select distinct on (o.product_id, o.store_id)
           o.id, o.product_id, o.price_cents
      from offers o
      join stores s on s.id = o.store_id
     where s.active
     order by o.product_id, o.store_id, o.collected_at desc
  )
  select count(*)::int               as pairs,
         count(distinct product_id)::int as products,
         coalesce(sum(price_cents), 0)::bigint as price_sum,
         md5(coalesce(string_agg(id::text, ',' order by id), '')) as digest
    from current_offer`

const SIZES = `
  select count(*)::int as offer_rows,
         pg_size_pretty(pg_total_relation_size('offers')) as offers,
         pg_size_pretty(pg_database_size(current_database())) as database,
         pg_database_size(current_database()) as database_bytes
    from offers`

interface Fingerprint {
  readonly pairs: number
  readonly products: number
  readonly price_sum: string
  readonly digest: string
}

function windowFromArgv(argv: readonly string[]): string {
  const at = argv.indexOf('--keep')
  return at >= 0 ? (argv[at + 1] ?? '3 days') : '3 days'
}

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) {
    console.error(
      'SUPABASE_DB_URL is not set. Supabase shows it under ' +
        'Settings > Database > Connection string > URI.',
    )
    process.exitCode = 1
    return
  }

  const keep = windowFromArgv(process.argv)
  const vacuum = process.argv.includes('--vacuum')

  const client = new Client({ connectionString, statement_timeout: STATEMENT_TIMEOUT_MS })
  await client.connect()

  try {
    const before = (await client.query<Fingerprint>(FINGERPRINT)).rows[0]
    const sizeBefore = (await client.query(SIZES)).rows[0]
    console.log('before:', sizeBefore.offer_rows, 'offers,', sizeBefore.offers, 'table,', sizeBefore.database, 'database')
    console.log('        ', before?.pairs, 'current offers over', before?.products, 'products')

    console.log(`pruning, keeping ${keep} of superseded history ...`)
    const { rows } = await client.query<{ prune_offers: number }>(
      'select prune_offers($1::interval) as prune_offers',
      [keep],
    )
    console.log('        ', rows[0]?.prune_offers, 'rows deleted')

    const after = (await client.query<Fingerprint>(FINGERPRINT)).rows[0]

    // The whole point of the exercise. Reported before the vacuum, so a
    // prune that lost a current offer is caught while the table is still
    // cheap to inspect.
    const intact =
      before !== undefined &&
      after !== undefined &&
      before.digest === after.digest &&
      before.pairs === after.pairs &&
      before.price_sum === after.price_sum

    if (!intact) {
      console.error('REFUSING: the set of current offers changed.')
      console.error('  before:', JSON.stringify(before))
      console.error('  after: ', JSON.stringify(after))
      process.exitCode = 1
      return
    }

    console.log('        ', `${after.pairs} current offers, unchanged (digest ${after.digest.slice(0, 12)})`)

    if (vacuum) {
      // Cannot run inside a transaction, which is why this is its own
      // statement on an auto-commit connection.
      console.log('rewriting offers to return the space (searches block) ...')
      await client.query('vacuum full analyze offers')
    } else {
      console.log('note: space is reusable but not returned. Pass --vacuum to reclaim it.')
    }

    const sizeAfter = (await client.query(SIZES)).rows[0]
    console.log('after: ', sizeAfter.offer_rows, 'offers,', sizeAfter.offers, 'table,', sizeAfter.database, 'database')

    const freed = Number(sizeBefore.database_bytes) - Number(sizeAfter.database_bytes)
    console.log('freed: ', (freed / 1024 / 1024).toFixed(1), 'MB of database')
  } finally {
    await client.end()
  }
}

void main()
