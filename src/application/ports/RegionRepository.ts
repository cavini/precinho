import type { Region } from '@/domain/entities/Region'

export interface RegionRepository {
  /** Every covered region. A short list, safe to read whole and cache. */
  listAll(): Promise<readonly Region[]>
  findBySlug(slug: string): Promise<Region | null>
}
