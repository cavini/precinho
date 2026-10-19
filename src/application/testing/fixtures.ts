import { Offer } from '@/domain/entities/Offer'
import type { Product } from '@/domain/entities/Product'
import type { Region } from '@/domain/entities/Region'
import type { Store } from '@/domain/entities/Store'
import { Ean } from '@/domain/value-objects/Ean'
import { Money } from '@/domain/value-objects/Money'
import { Quantity } from '@/domain/value-objects/Quantity'
import type { StoredOffer } from './InMemoryRepositories'

export const COLLECTED_AT = new Date('2026-10-19T06:00:00Z')

export const REGION_SP: Region = {
  id: 'region-sp',
  slug: 'sao-paulo-sp',
  name: 'São Paulo',
  city: 'São Paulo',
  uf: 'SP',
  isUfDefault: true,
}

export const REGION_RJ: Region = {
  id: 'region-rj',
  slug: 'rio-de-janeiro-rj',
  name: 'Rio de Janeiro',
  city: 'Rio de Janeiro',
  uf: 'RJ',
  isUfDefault: true,
}

export const STORES: readonly Store[] = [
  { id: 'mambo', slug: 'mambo', name: 'Mambo', chain: 'Mambo', regionId: REGION_SP.id },
  {
    id: 'hortifruti',
    slug: 'hortifruti',
    name: 'Hortifruti',
    chain: 'Hortifruti',
    regionId: REGION_SP.id,
  },
  {
    id: 'naturaldaterra',
    slug: 'naturaldaterra',
    name: 'Natural da Terra',
    chain: 'Natural da Terra',
    regionId: REGION_SP.id,
  },
  { id: 'zonasul', slug: 'zonasul', name: 'Zona Sul', chain: 'Zona Sul', regionId: REGION_RJ.id },
]

export function aProduct(overrides: Partial<Product> & { id: string }): Product {
  const name = overrides.name ?? 'Produto'
  return {
    ean: null,
    name,
    brand: null,
    size: null,
    imageUrl: null,
    searchText: name.toLowerCase(),
    matchKey: `store:test:${overrides.id}`,
    ...overrides,
  }
}

export function anOffer(
  productId: string,
  storeId: string,
  reais: number,
  overrides: { inStock?: boolean; listPriceReais?: number; collectedAt?: Date } = {},
): StoredOffer {
  return {
    productId,
    offer: Offer.create({
      storeId,
      price: Money.fromReais(reais),
      listPrice: overrides.listPriceReais ? Money.fromReais(overrides.listPriceReais) : null,
      url: `https://example.com/${storeId}/${productId}`,
      inStock: overrides.inStock ?? true,
      collectedAt: overrides.collectedAt ?? COLLECTED_AT,
    }),
  }
}

/**
 * The real spread I measured across São Paulo chains: a 2L Coca-Cola at
 * R$ 14,98 in one and R$ 10,49 in another, same barcode, same week.
 */
export const COCA_COLA_2L = aProduct({
  id: 'coca-2l',
  ean: Ean.tryParse('7894900027013'),
  name: 'Refrigerante Coca-Cola 2L',
  brand: 'Coca-Cola',
  size: Quantity.of(2, 'L'),
  searchText: 'refrigerante coca-cola 2l coca-cola',
  matchKey: 'gtin:07894900027013',
})

export const CONDENSED_MILK = aProduct({
  id: 'leite-cond-395g',
  ean: Ean.tryParse('7898215152002'),
  name: 'Leite Condensado Piracanjuba 395g',
  brand: 'Piracanjuba',
  size: Quantity.of(0.395, 'kg'),
  searchText: 'leite condensado piracanjuba 395g',
  matchKey: 'gtin:07898215152002',
})

/** Loose produce: no barcode, so it stays store-local. */
export const BANANA = aProduct({
  id: 'banana-mambo',
  name: 'Banana Prata',
  searchText: 'banana prata',
  matchKey: 'store:mambo:banana-prata',
})
