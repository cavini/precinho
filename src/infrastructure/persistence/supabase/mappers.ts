import { Offer } from '@/domain/entities/Offer'
import type { Product } from '@/domain/entities/Product'
import type { Region } from '@/domain/entities/Region'
import type { Store } from '@/domain/entities/Store'
import { Ean } from '@/domain/value-objects/Ean'
import { Money } from '@/domain/value-objects/Money'
import { Quantity } from '@/domain/value-objects/Quantity'
import type { CanonicalUnit } from '@/domain/value-objects/Quantity'

/**
 * Database rows to domain objects.
 *
 * Pure, and separate from the repositories, so the mapping is testable
 * without a database — which matters because this is where a bad row has to
 * be survived rather than crash a page. A single malformed offer should cost
 * that offer, not the whole listing.
 */

export type RegionRow = {
  id: string
  slug: string
  name: string
  city: string
  uf: string
  is_uf_default: boolean
}

export type StoreRow = {
  id: string
  slug: string
  name: string
  chain: string
  region_id: string
}

export type ProductFields = {
  product_id: string
  name: string
  description?: string | null
  brand: string | null
  size_amount: number | string | null
  size_unit: string | null
  image_url: string | null
  gtin14: string | null
}

export type OfferRow = {
  store_id: string
  price_cents: number
  list_price_cents: number | null
  url: string
  in_stock: boolean
  collected_at: string
}

export function toRegion(row: RegionRow): Region {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    uf: row.uf,
    isUfDefault: row.is_uf_default,
  }
}

export function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    chain: row.chain,
    regionId: row.region_id,
  }
}

export function toProduct(fields: ProductFields): Product {
  const ean = Ean.tryParse(fields.gtin14)

  return {
    id: fields.product_id,
    ean,
    name: fields.name,
    description: fields.description ?? null,
    brand: fields.brand,
    size: toQuantity(fields.size_amount, fields.size_unit),
    imageUrl: fields.image_url,
    // Not selected by the read path: search matches on it in the database and
    // nothing above needs it back.
    searchText: '',
    matchKey: ean ? `gtin:${ean.gtin14}` : `product:${fields.product_id}`,
  }
}

/**
 * Null rather than a throw for a size that will not parse. A product with an
 * unreadable size is still worth listing; it just gets no price-per-unit.
 */
export function toQuantity(amount: number | string | null, unit: string | null): Quantity | null {
  if (amount === null || unit === null) return null
  if (unit !== 'kg' && unit !== 'L' && unit !== 'un') return null

  // numeric comes back as a string from Postgres to avoid precision loss.
  const value = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(value) || value <= 0) return null

  return Quantity.of(value, unit as CanonicalUnit)
}

/**
 * Null when the row cannot become an offer — a price of zero, an unusable
 * link, an unparseable timestamp. The caller drops it and carries on.
 */
export function toOffer(row: OfferRow): Offer | null {
  try {
    const collectedAt = new Date(row.collected_at)
    if (Number.isNaN(collectedAt.getTime())) return null

    return Offer.create({
      storeId: row.store_id,
      price: Money.fromCents(row.price_cents),
      listPrice: row.list_price_cents === null ? null : Money.fromCents(row.list_price_cents),
      url: row.url,
      inStock: row.in_stock,
      collectedAt,
    })
  } catch {
    return null
  }
}
