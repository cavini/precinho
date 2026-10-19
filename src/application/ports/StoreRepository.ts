import type { Store } from '@/domain/entities/Store'

export interface StoreRepository {
  /** The stores a shopper in this region can buy from, for the picker. */
  listByRegion(regionId: string): Promise<readonly Store[]>
}
