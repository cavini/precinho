import type { Logger } from '../ports/Logger'
import type { RegionRepository } from '../ports/RegionRepository'
import type { StoreRepository } from '../ports/StoreRepository'
import type { ShoppingContextStore } from './ResolveShoppingContext'

export type CoveredArea = {
  regionId: string
  /** As the screens should name it, so the code never has to. */
  regionName: string
  stores: readonly ShoppingContextStore[]
}

export type GetCoveredAreaDeps = {
  regionRepository: RegionRepository
  storeRepository: StoreRepository
  logger: Logger
}

/**
 * The area whose prices this is showing.
 *
 * Coverage is where shops are actually being collected, not a list
 * written down somewhere: a region row with nothing active behind it is
 * a region in name only, and showing its name over an empty comparison
 * would be worse than saying nothing.
 *
 * Returns the first such area. There is one today, and the day there are
 * two this becomes a choice to put in front of somebody rather than a
 * silent pick — which is why it returns the area rather than assuming
 * it.
 */
export class GetCoveredArea {
  constructor(private readonly deps: GetCoveredAreaDeps) {}

  /** Complexity: one query for the regions, then one per region until a covered one. */
  async execute(): Promise<CoveredArea | null> {
    const regions = await this.deps.regionRepository.listAll()

    for (const region of regions) {
      const stores = await this.deps.storeRepository.listByRegion(region.id)
      if (stores.length === 0) continue

      return {
        regionId: region.id,
        regionName: region.name,
        stores: [...stores]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((store) => ({
            id: store.id,
            slug: store.slug,
            name: store.name,
            chain: store.chain,
          })),
      }
    }

    this.deps.logger.warn('coverage.none', { regions: regions.length })
    return null
  }
}
