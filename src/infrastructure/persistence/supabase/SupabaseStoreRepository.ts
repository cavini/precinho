import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from '@/application/ports/Logger'
import type { StoreRepository } from '@/application/ports/StoreRepository'
import type { Store } from '@/domain/entities/Store'
import { type StoreRow, toStore } from './mappers'

export class SupabaseStoreRepository implements StoreRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Only the fields the domain needs; host, platform and area tokens stay in
   * the table for the collector.
   *
   * Complexity: O(s) through stores_region_active_idx.
   */
  async listByRegion(regionId: string): Promise<readonly Store[]> {
    const { data, error } = await this.client
      .from('stores')
      .select('id, slug, name, chain, region_id')
      .eq('region_id', regionId)
      .eq('active', true)
      .order('name')

    if (error) {
      this.logger.error('stores.list_failed', { regionId, reason: error.message })
      return []
    }

    return (data as StoreRow[]).map(toStore)
  }
}
