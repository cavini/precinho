import { describe, expect, it } from 'vitest'
import { InMemoryStoreRepository, UnreadableStoreRepository } from '../testing/InMemoryRepositories'
import { RecordingLogger } from '../testing/RecordingLogger'
import { REGION_SP, STORES } from '../testing/fixtures'
import { ListRegionStores } from './ListRegionStores'

function build() {
  return new ListRegionStores({
    storeRepository: new InMemoryStoreRepository(STORES),
    logger: new RecordingLogger(),
  })
}

describe('ListRegionStores', () => {
  it('lists the stores of one region, alphabetically', async () => {
    // A picker that reorders between page loads is unusable.
    const stores = await build().execute(REGION_SP.id)

    expect(stores.map((store) => store.name)).toEqual(['Hortifruti', 'Mambo', 'Natural da Terra'])
  })

  it('leaves out stores from other regions', async () => {
    const stores = await build().execute(REGION_SP.id)
    expect(stores.map((store) => store.id)).not.toContain('zonasul')
  })

  it('returns nothing for a region with no stores', async () => {
    expect(await build().execute('region-unknown')).toEqual([])
  })

  it('exposes only what the picker needs', async () => {
    const [store] = await build().execute(REGION_SP.id)
    expect(Object.keys(store).sort()).toEqual(['chain', 'id', 'name', 'slug'])
  })
})

describe('ListRegionStores when the read fails', () => {
  it('returns nothing rather than throwing, because the picker can live without it', async () => {
    // Deliberate, and the reason is that nothing reaches this any more:
    // it is a leftover of the postcode picker. If it ever renders again
    // this should become an unavailable state like the other reads.
    const useCase = new ListRegionStores({
      storeRepository: new UnreadableStoreRepository(STORES),
      logger: new RecordingLogger(),
    })

    expect(await useCase.execute(REGION_SP.id)).toEqual([])
  })
})
