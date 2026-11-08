/**
 * Removes products nothing sells and nothing has judged.
 *
 * 0051 narrowed collection to one region, and 0065 then deleted the offers
 * belonging to the sixteen stores left behind. The products those offers
 * pointed at stayed: rows no shop prices, no screen can reach — every
 * reader joins offers — and no verdict has an opinion about. Here that is
 * 11,651 of them, about 11 MB once their names and aliases go with them.
 *
 * What it will not touch is a product carrying judged work. A verdict is a
 * paid answer to "are these two the same", kept so the question is never
 * asked twice, and `product_equivalences` cascades on product delete: take
 * the row away and the answer goes with it, to be bought again the next
 * time the shortlist proposes the pair. The same goes for `product_merges`,
 * which is how a wrong merge is traced back to whoever decided it. Those
 * 1,213 products stay, costing a megabyte, because the alternative costs
 * money.
 *
 * Safe to re-run. It is not on the nightly path: orphans arrive when a
 * store is deactivated, not every night, so this is a thing to run after
 * one is — and running it when there is nothing to do is a cheap no-op.
 *
 * Usage: npm run prune:products
 *        npm run prune:products -- --dry-run
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { Client } from 'pg'

/** Rows per delete, so one statement never holds a long lock. */
const BATCH = 2_000

/**
 * Long enough for a full pass over products against offers.
 *
 * The counting query asks, for every product, whether anything anywhere
 * points at it. That is three index lookups across 118,912 rows, which is
 * comfortably past the default the pooler allows.
 */
const STATEMENT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * The set of products a reader can reach, as one comparable value.
 *
 * Every screen reaches products through offers, so this is what must not
 * move. Comparing it before and after is a stronger statement on real data
 * than any argument about which rows the predicate selects.
 */
const FINGERPRINT = `
  select count(*)::int as products,
         md5(coalesce(string_agg(id::text, ',' order by id), '')) as digest
    from products p
   where exists (select 1 from offers o where o.product_id = p.id)`

/**
 * Orphaned, and carrying nothing worth keeping.
 *
 * The two `not exists` clauses are the whole safety policy, stated once
 * and used by both the count and the delete so they cannot drift.
 */
const DELETABLE = `
  select p.id
    from products p
   where not exists (select 1 from offers o where o.product_id = p.id)
     and not exists (select 1 from product_equivalences e
                      where e.left_id = p.id or e.right_id = p.id)
     and not exists (select 1 from product_merges m where m.survivor_id = p.id)`

type Fingerprint = { products: number; digest: string }

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

  const dryRun = process.argv.includes('--dry-run')
  const client = new Client({ connectionString, statement_timeout: STATEMENT_TIMEOUT_MS })
  await client.connect()

  try {
    const before = (await client.query<Fingerprint>(FINGERPRINT)).rows[0]
    // One pass rather than four correlated ones: the same scan answers how
    // many are orphaned, how many of those are safe, and how many are held
    // back by judged work.
    const counts = (
      await client.query<{ orphans: string; deletable: string; kept: string; size: string }>(`
      with orphan as (
        select exists (select 1 from product_equivalences e
                        where e.left_id = p.id or e.right_id = p.id)
            or exists (select 1 from product_merges m where m.survivor_id = p.id) as judged
          from products p
         where not exists (select 1 from offers o where o.product_id = p.id))
      select count(*) as orphans,
             count(*) filter (where not judged) as deletable,
             count(*) filter (where judged) as kept,
             (select pg_size_pretty(pg_database_size(current_database()))) as size
        from orphan`)
    ).rows[0]

    console.log(`before: ${before.products} products on sale, ${counts.size} database`)
    console.log(`        ${counts.orphans} orphaned, of which ${counts.deletable} carry no verdict`)
    console.log(`        ${counts.kept} kept because a verdict or a merge points at them`)

    if (dryRun) {
      console.log('\n--dry-run: nothing deleted')
      return
    }

    let removed = 0
    for (;;) {
      const { rowCount } = await client.query(
        `delete from products where id in (${DELETABLE} limit ${BATCH})`,
      )
      if (!rowCount) break
      removed += rowCount
      console.log(`  ${removed}/${counts.deletable}`)
    }

    const after = (await client.query<Fingerprint>(FINGERPRINT)).rows[0]
    const size = (
      await client.query<{ size: string }>(
        'select pg_size_pretty(pg_database_size(current_database())) as size',
      )
    ).rows[0]

    console.log(`\nremoved ${removed} products`)
    console.log(`after:  ${after.products} products on sale, ${size.size} database`)

    // The whole point, checked rather than asserted: a product anybody can
    // reach is a product with an offer, and that set has to be identical.
    if (after.digest !== before.digest) {
      console.error('\nREFUSED: the set of products on sale changed. Investigate before trusting.')
      process.exitCode = 1
      return
    }
    console.log(`products on sale unchanged (digest ${before.digest.slice(0, 12)})`)
  } finally {
    await client.end()
  }
}

void main()
