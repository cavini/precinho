import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from '@/application/ports/Logger'
import type { RegionRepository } from '@/application/ports/RegionRepository'
import type { Region } from '@/domain/entities/Region'
import { type RegionRow, toRegion } from './mappers'

const COLUMNS = 'id, slug, name, city, uf, is_uf_default'

/**
 * Regions are a handful of rows that change when I add a city, so this is
 * the one table worth reading whole.
 */
export class SupabaseRegionRepository implements RegionRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  /** Complexity: O(r), a full read of a tiny table. */
  async listAll(): Promise<readonly Region[]> {
    const { data, error } = await this.client.from('regions').select(COLUMNS).order('slug')

    if (error) {
      this.logger.error('regions.list_failed', { reason: error.message })
      // An empty list reads downstream as "no coverage", which is the honest
      // answer when we cannot tell what we cover.
      return []
    }

    return (data as RegionRow[]).map(toRegion)
  }

  async findBySlug(slug: string): Promise<Region | null> {
    const { data, error } = await this.client
      .from('regions')
      .select(COLUMNS)
      .eq('slug', slug)
      .maybeSingle()

    if (error) {
      this.logger.error('regions.find_failed', { slug, reason: error.message })
      return null
    }

    return data ? toRegion(data as RegionRow) : null
  }
}
