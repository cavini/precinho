/**
 * Asks every chain whether the prices we store are really that region's.
 *
 * The test is the only one that settles it: fetch the same products twice
 * under two different region contexts and compare. If nothing moves, we
 * are recording one national price list under a regional label, and the
 * whole premise of the app — the cheapest price near you — is wrong.
 *
 * Tenda's own product page says it outright: "Informe seu CEP para
 * visualizar o preco" and "Os precos podem sofrer alteracao de acordo com
 * a sua regiao". A chain saying that while our collector stores a single
 * number is a bug, not a finding about the market. Measured on 2026-10-20
 * it was telling the truth: a Taubate cart moves 7 of 117 matched prices
 * and drops 27% of the listing. The default it answers without a cart is
 * Sao Paulo's, matched 160 of 160 against the Guarapiranga branch.
 *
 * Usage: `npx tsx scripts/audit-regionalisation.ts [slug ...]`
 *
 * Complexity: two resolutions and 2t searches per store for t terms,
 * four stores at a time.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import type { Logger } from '@/application/ports/Logger'
import type { CatalogProduct, StoreCatalogGateway } from '@/application/ports/StoreCatalogGateway'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import { readCollectorEnv } from '@/infrastructure/config/env'
import { GpaCatalogGateway } from '@/infrastructure/gateways/gpa/GpaCatalogGateway'
import { SfccCatalogGateway } from '@/infrastructure/gateways/sfcc/SfccCatalogGateway'
import { TendaCatalogGateway } from '@/infrastructure/gateways/tenda/TendaCatalogGateway'
import { VipCommerceCatalogGateway } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import type { VipCommerceStoreConfig } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import { VtexCatalogGateway } from '@/infrastructure/gateways/vtex/VtexCatalogGateway'
import { FetchHttpClient } from '@/infrastructure/http/FetchHttpClient'
import { StructuredLogger } from '@/infrastructure/observability/StructuredLogger'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'
import type { StoreRow } from './storeRow'

/** Staples every chain carries, so the comparison has something to match on. */
const TERMS = ['arroz', 'leite', 'cafe', 'detergente'] as const

/** The region a shopper is in, against no region at all. */
const HERE = PostalCode.tryParse('01310100')! // São Paulo, Avenida Paulista
const THERE = PostalCode.tryParse('22071900')! // Rio de Janeiro, kept for reference

/** GPA prices by numeric store, so the pair is two stores rather than two CEPs. */
const GPA_PAIR = { here: 461, there: 1384 } // Ricardo Jafet (SP) and Independência (Taubaté)

type Verdict = {
  slug: string
  platform: string
  matched: number
  differing: number
  examples: string[]
  note?: string
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const env = readCollectorEnv()
  const logger = new StructuredLogger({ level: 'error' }).child({ job: 'audit' })
  const http = new FetchHttpClient(logger)
  const client = createWriteClient(env)

  const { data } = await client
    .from('stores')
    .select(
      'slug, host, platform, sales_channel, path_prefix, store_view, region_token, storefront_host',
    )
    .eq('active', true)
    .order('slug')

  const stores = ((data ?? []) as unknown as StoreRow[]).filter(
    (store) =>
      (wanted.length === 0 || wanted.includes(store.slug)) &&
      // Tauste is swept under an agreed daily cap; spending it on an audit
      // would break the promise the cap exists to keep.
      store.platform !== 'magento-graphql',
  )

  const verdicts: Verdict[] = []
  for (let index = 0; index < stores.length; index += 4) {
    verdicts.push(
      ...(await Promise.all(
        stores.slice(index, index + 4).map((store) => audit(store, http, logger)),
      )),
    )
  }

  console.log('')
  for (const verdict of verdicts.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const share = verdict.matched > 0 ? Math.round((verdict.differing / verdict.matched) * 100) : 0
    const label =
      verdict.note ??
      (verdict.matched === 0
        ? 'inconclusive — nothing matched'
        : verdict.differing === 0
          ? "ok — the stored price is the region's price"
          : `WRONG — ${verdict.differing}/${verdict.matched} stored prices are not the region's (${share}%)`)

    console.log(`  ${verdict.slug.padEnd(20)} ${label}`)
    for (const example of verdict.examples.slice(0, 2)) console.log(`      ${example}`)
  }
}

async function audit(store: StoreRow, http: FetchHttpClient, logger: Logger): Promise<Verdict> {
  const base = {
    storeId: store.slug,
    host: store.host,
    pathPrefix: store.path_prefix ?? undefined,
    salesChannel: store.sales_channel ?? undefined,
  }

  if (store.platform === 'vtex-legacy') {
    const prober = new VtexCatalogGateway(base, http, logger)
    const [here, there] = await Promise.all([
      prober.resolveRegion(HERE),
      prober.resolveRegion(THERE),
    ])

    if (!here || !there) {
      return {
        slug: store.slug,
        platform: store.platform,
        matched: 0,
        differing: 0,
        examples: [],
        note: 'could not resolve both regions',
      }
    }
    // The comparison that finds OUR bug rather than the market's shape:
    // what the collector stores against what the shop quotes a person
    // standing in that region. Both sides must not be the same endpoint —
    // catalog_system ignores regionId for pricing, so comparing it with
    // itself says "fine" no matter how wrong the number is.
    void there
    return compareWithStorefront(
      store,
      new VtexCatalogGateway({ ...base, regionToken: here.regionToken }, http, logger),
      here.regionToken,
    )
  }

  if (store.platform === 'gpa-api') {
    const banner = store.store_view ?? 'pa'
    return compare(
      store,
      new GpaCatalogGateway(
        { storeId: store.slug, banner, gpaStoreId: GPA_PAIR.here },
        http,
        logger,
      ),
      new GpaCatalogGateway(
        { storeId: store.slug, banner, gpaStoreId: GPA_PAIR.there },
        http,
        logger,
      ),
    )
  }

  if (store.platform === 'tenda-api') {
    // This used to vary branchId, which only narrows the in-stock flag and
    // never touches the URL — so it compared one request with itself and
    // could only ever answer "uniform". Tenda prices per branch and the
    // cart is the only thing that carries the branch, so the comparison is
    // the row's cart against no cart at all: what the collector stores
    // against what the endpoint hands anyone who does not say where they
    // are. Without a cart configured there is nothing to compare.
    if (!store.region_token) {
      return inconclusive(store, 'row carries no branch-bound cart; prices are São Paulo’s')
    }

    return branchComparison(
      store,
      await compare(
        store,
        new TendaCatalogGateway(
          { storeId: store.slug, apiHost: store.host, cartId: store.region_token },
          http,
          logger,
        ),
        new TendaCatalogGateway({ storeId: store.slug, apiHost: store.host }, http, logger),
      ),
      `cart ${store.region_token} and no cart (the São Paulo default)`,
    )
  }

  if (store.platform === 'vipcommerce') {
    const row = vipCommerceRow(store)
    if (!row) return inconclusive(store, 'row is missing the ids the platform needs')

    // Taubaté against Caçapava: two branches of the same chain, which is
    // the only lever VipCommerce has. The pair is hard-coded because the
    // point is to re-check the finding, not to discover a new one.
    return branchComparison(
      store,
      await compare(
        store,
        new VipCommerceCatalogGateway({ ...row, distributionCenterId: '10' }, http, logger),
        new VipCommerceCatalogGateway({ ...row, distributionCenterId: '11' }, http, logger),
      ),
      'centres 10 (Taubaté) and 11 (Caçapava)',
    )
  }

  if (store.platform === 'sfcc') {
    if (!store.store_view) return inconclusive(store, 'row carries no Demandware site id')

    const site = { storeId: store.slug, host: store.host, siteId: store.store_view }

    return branchComparison(
      store,
      await compare(
        store,
        new SfccCatalogGateway({ ...site, sfccStoreId: '25' }, http, logger),
        new SfccCatalogGateway({ ...site, sfccStoreId: '7' }, http, logger),
      ),
      'branches 25 (Taubaté) and 7 (São Paulo)',
    )
  }

  return {
    slug: store.slug,
    platform: store.platform,
    matched: 0,
    differing: 0,
    examples: [],
    note: 'no audit for this platform',
  }
}

/** The VipCommerce ids a comparison needs, or null when the row lacks them. */
function vipCommerceRow(
  store: StoreRow,
): Omit<VipCommerceStoreConfig, 'distributionCenterId'> | null {
  const { sales_channel: organizationId, store_view: branchId, storefront_host: host } = store
  if (!organizationId || !branchId || !host) return null

  return {
    storeId: store.slug,
    apiHost: store.host,
    organizationId,
    branchId,
    domainKey: host.replace(/^(?:www|site|rc|site-cdn|cdn)\./, ''),
    storefrontHost: host,
  }
}

function inconclusive(store: StoreRow, note: string): Verdict {
  return {
    slug: store.slug,
    platform: store.platform,
    matched: 0,
    differing: 0,
    examples: [],
    note,
  }
}

/**
 * Says what a two-branch comparison actually measured.
 *
 * The default label below is written for the storefront comparison, where
 * no difference means our number matches the shop's. Here no difference
 * means the two branches quote alike, which is a fact about the chain
 * rather than a verdict on us — Shibata prices its whole Vale do Paraíba
 * the same and is right to. So this reports the measurement and names the
 * one thing that would settle it, instead of borrowing a word that would
 * mean the opposite.
 *
 * Complexity: O(1) over an already-computed verdict.
 */
function branchComparison(store: StoreRow, verdict: Verdict, pair: string): Verdict {
  if (verdict.matched === 0) return inconclusive(store, `nothing matched across ${pair}`)

  const note =
    verdict.differing > 0
      ? `regional — ${verdict.differing}/${verdict.matched} prices move between ${pair}`
      : `uniform — ${verdict.matched} prices identical across ${pair}; ` +
        'check the assortment differs before trusting it'

  return { ...verdict, note }
}

/**
 * Our collector's price against the one the storefront quotes.
 *
 * The catalogue endpoint we sweep returns the default sales policy and
 * ignores regionId; Intelligent Search is what the shop's own pages call
 * and it honours the region. Where the two disagree, the number in our
 * database is not a price anybody is offered.
 */
async function compareWithStorefront(
  store: StoreRow,
  ours: StoreCatalogGateway,
  regionToken: string,
): Promise<Verdict> {
  let matched = 0
  let differing = 0
  const examples: string[] = []

  for (const term of TERMS) {
    const mine = await ours.searchTerm(term)
    if (mine.status !== 'ok') continue

    const theirs = await storefrontPrices(store.host, term, regionToken)
    if (theirs === null) {
      return {
        slug: store.slug,
        platform: store.platform,
        matched: 0,
        differing: 0,
        examples: [],
        note: 'storefront search unavailable — cannot verify',
      }
    }

    for (const product of mine.products) {
      const quoted = theirs.get(product.externalId)
      if (quoted === undefined || quoted <= 0) continue

      matched += 1
      if (Math.abs(product.priceReais - quoted) > 0.001) {
        differing += 1
        if (examples.length < 4) {
          examples.push(
            `${product.name.slice(0, 40)}  nosso ${product.priceReais.toFixed(2)} vs loja ${quoted.toFixed(2)}`,
          )
        }
      }
    }
  }

  return { slug: store.slug, platform: store.platform, matched, differing, examples }
}

/** Only the parts of an Intelligent Search product this comparison reads. */
type StorefrontProduct = {
  productId?: string | number
  items?: Array<{ sellers?: Array<{ commertialOffer?: { Price?: number } }> }>
}

/** Product id to price, as the shop's own storefront would show it. */
async function storefrontPrices(
  host: string,
  term: string,
  regionToken: string,
): Promise<Map<string, number> | null> {
  const url =
    `https://${host}/api/io/_v/api/intelligent-search/product_search/` +
    `?query=${encodeURIComponent(term)}&count=50&locale=pt-BR&regionId=${encodeURIComponent(regionToken)}`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'precinho-collector/1.0 (+https://github.com/cavini/precinho)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) return null

    const body = (await response.json()) as { products?: StorefrontProduct[] }
    const prices = new Map<string, number>()

    for (const product of body.products ?? []) {
      const price = product.items?.[0]?.sellers?.[0]?.commertialOffer?.Price
      if (typeof price === 'number') prices.set(String(product.productId), price)
    }

    return prices
  } catch {
    return null
  }
}

/** Matches products by their store-side id and reports where the prices part company. */
async function compare(
  store: StoreRow,
  a: StoreCatalogGateway,
  b: StoreCatalogGateway,
): Promise<Verdict> {
  let matched = 0
  let differing = 0
  const examples: string[] = []

  for (const term of TERMS) {
    const [left, right] = await Promise.all([a.searchTerm(term), b.searchTerm(term)])
    if (left.status !== 'ok' || right.status !== 'ok') continue

    const byId = new Map<string, CatalogProduct>()
    for (const product of right.products) byId.set(product.externalId, product)

    for (const product of left.products) {
      const twin = byId.get(product.externalId)
      if (!twin) continue

      matched += 1
      if (Math.abs(product.priceReais - twin.priceReais) > 0.001) {
        differing += 1
        if (examples.length < 4) {
          examples.push(
            `${product.name.slice(0, 44)}  ${product.priceReais.toFixed(2)} vs ${twin.priceReais.toFixed(2)}`,
          )
        }
      }
    }
  }

  return { slug: store.slug, platform: store.platform, matched, differing, examples }
}

void main()
