import type { Logger } from '../ports/Logger'
import type { StoreRepository } from '../ports/StoreRepository'
import type { ShoppingContextStore } from './ResolveShoppingContext'

export type ListRegionStoresDeps = {
  storeRepository: StoreRepository
  logger: Logger
}

/**
 * The stores a returning visitor can pick between.
 *
 * Separate from ResolveShoppingContext on purpose. Somebody arriving with a
 * CEP already in their cookie needs the store list on every page, and
 * re-resolving their CEP to get it would call ViaCEP on every page load for
 * an answer that has not changed.
 */
export class ListRegionStores {
  constructor(private readonly deps: ListRegionStoresDeps) {}

  /** Complexity: O(s) over the region's stores, sorted for a stable picker. */
  async execute(regionId: string): Promise<readonly ShoppingContextStore[]> {
    const stores = (await this.deps.storeRepository.listByRegion(regionId)) ?? []

    return [...stores]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((store) => ({
        id: store.id,
        slug: store.slug,
        name: store.name,
        chain: store.chain,
      }))
  }
}
