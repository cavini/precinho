import type { Store } from '@/domain/entities/Store'

export interface StoreRepository {
  /**
   * The stores a shopper in this region can buy from, for the picker.
   *
   * Null when the read failed, so a caller can tell "this region has no
   * shops" from "I could not find out".
   */
  listByRegion(regionId: string): Promise<readonly Store[] | null>
}
