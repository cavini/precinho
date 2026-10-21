import { describe, expect, it } from 'vitest'
import { GetCoveredArea } from './GetCoveredArea'
import { InMemoryRegionRepository, InMemoryStoreRepository } from '../testing/InMemoryRepositories'
import { RecordingLogger } from '../testing/RecordingLogger'
import { REGION_RJ, REGION_SP, STORES } from '../testing/fixtures'

/** A region row with no shops behind it. */
const ELSEWHERE = { ...REGION_RJ, id: 'region-empty', slug: 'somewhere-else' }

function build(regions = [REGION_SP], stores = STORES) {
  const logger = new RecordingLogger()
  const useCase = new GetCoveredArea({
    regionRepository: new InMemoryRegionRepository(regions),
    storeRepository: new InMemoryStoreRepository(stores),
    logger,
  })
  return { useCase, logger }
}

describe('GetCoveredArea', () => {
  it('names the area whose shops are being collected', async () => {
    // The screens take the name from here so the source never has to
    // know which place this is.
    const { useCase } = build()

    expect(await useCase.execute()).toMatchObject({
      regionId: REGION_SP.id,
      regionName: REGION_SP.name,
    })
  })

  it('lists its shops in a stable order', async () => {
    // The picker renders this list, and a list that reshuffles between
    // requests moves the checkbox somebody was reaching for.
    const { useCase } = build()
    const area = await useCase.execute()

    const names = area?.stores.map((store) => store.name) ?? []
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('skips a region with nothing behind it', async () => {
    // A region row with no active shops is a region in name only, and
    // naming it over an empty comparison is worse than saying nothing.
    const { useCase } = build([ELSEWHERE, REGION_SP])

    expect((await useCase.execute())?.regionId).toBe(REGION_SP.id)
  })

  it('reports no coverage when nothing is being collected anywhere', async () => {
    const { useCase } = build([ELSEWHERE], [])

    expect(await useCase.execute()).toBeNull()
  })

  it('says so in the log, because an empty site explains nothing on its own', async () => {
    const { useCase, logger } = build([ELSEWHERE], [])
    await useCase.execute()

    expect(logger.lines.map((line) => line.message)).toContain('coverage.none')
  })

  it('carries the slug through, which is what the collector is driven by', async () => {
    const { useCase } = build()
    const area = await useCase.execute()

    expect(area?.stores[0]).toHaveProperty('slug')
    expect(area?.stores[0]).toHaveProperty('chain')
  })
})
