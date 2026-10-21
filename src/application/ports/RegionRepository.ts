import type { Region } from '@/domain/entities/Region'

export interface RegionRepository {
  /**
   * Every covered region. A short list, safe to read whole and cache.
   *
   * Null when the read itself failed, which is not the same as there
   * being no regions: collapsing the two is what made the site announce
   * that nothing anywhere was being tracked.
   */
  listAll(): Promise<readonly Region[] | null>
  findBySlug(slug: string): Promise<Region | null>
}
