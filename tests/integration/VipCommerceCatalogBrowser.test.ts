import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { VipCommerceCatalogBrowser } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogBrowser'
import type { VipCommerceStoreConfig } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import type { FakeRoute } from '@/infrastructure/testing/FakeHttpClient'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/** Shibata's own department tree, read on 2026-10-19. */
const SHIBATA_TREE: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/shibata-department-tree.json'), 'utf8'),
)

const SHIBATA_CAFE: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/shibata-cafe-search.json'), 'utf8'),
)

const LOGIN = /auth\/loja\/login/
const TREE = /departamentos\/arvore/
const DEPARTMENT = /departamentos\/\d+\/produtos/

const loginOk = {
  status: 'ok',
  statusCode: 200,
  body: { success: true, data: 'token' },
} as const

const BASE: VipCommerceStoreConfig = {
  storeId: 'shibata-taubate',
  organizationId: '161',
  branchId: '1',
  distributionCenterId: '10',
  domainKey: 'loja.shibata.com.br',
  storefrontHost: 'www.loja.shibata.com.br',
}

/** Department 3 holds 2,771 products; department 1 holds 412. */
function sizedDepartments(): FakeRoute {
  return {
    match: DEPARTMENT,
    response: {
      status: 'ok',
      statusCode: 200,
      body: { success: true, data: [], paginator: { total_items: 2771 } },
    },
  }
}

function build(routes: readonly FakeRoute[]) {
  const http = new FakeHttpClient([{ match: LOGIN, response: loginOk }, ...routes])
  const logger = new RecordingLogger()
  const browser = new VipCommerceCatalogBrowser(BASE, http, logger)
  return { browser, http, logger }
}

const treeOk = {
  match: TREE,
  response: { status: 'ok', statusCode: 200, body: SHIBATA_TREE },
} as const

describe('VipCommerceCatalogBrowser planning a sweep', () => {
  it('turns every department into a slice', async () => {
    const { browser } = build([treeOk, sizedDepartments()])
    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((slice) => slice.label)).toEqual(['Bebidas', 'Açougue'])
  })

  it('sizes a department from the paginator, not from total_ofertas', async () => {
    // The tree publishes total_ofertas on every node and it is not a
    // product count: Bebidas reports 204 there against 2,771 on the
    // paginator, because it counts what is on special offer. Planning from
    // it would have swept a fourteenth of the shop and looked fine.
    const { browser } = build([treeOk, sizedDepartments()])
    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices[0].size).toBe(2771)
    expect(plan.slices[0].size).not.toBe(204)
  })

  it('spends one request per department plus one for the tree', async () => {
    const { browser, http } = build([treeOk, sizedDepartments()])
    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.requestsSpent).toBe(3)
    expect(http.requests.filter((request) => TREE.test(request.url))).toHaveLength(1)
  })

  it('reports nothing unreachable, because the API pages to the end', async () => {
    // Unlike VTEX, which refuses an offset past 2,500, this one answered
    // page 12 of 12 for a 2,771-product department and an empty page 13.
    const { browser } = build([treeOk, sizedDepartments()])
    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.unreachable).toEqual([])
  })

  it('drops a department the store reports as empty', async () => {
    const { browser } = build([
      treeOk,
      {
        match: DEPARTMENT,
        response: {
          status: 'ok',
          statusCode: 200,
          body: { success: true, data: [], paginator: { total_items: 0 } },
        },
      },
    ])
    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices).toEqual([])
  })

  it('drops a department whose count is not a number', async () => {
    // A size that arrived as a string would divide into NaN when the sweep
    // works out how many pages to ask for, and a slice that stops after
    // one page looks exactly like a small department.
    const { browser } = build([
      treeOk,
      {
        match: DEPARTMENT,
        response: {
          status: 'ok',
          statusCode: 200,
          body: { success: true, data: [], paginator: { total_items: '2771' } },
        },
      },
    ])
    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices).toEqual([])
  })

  it('reports unavailable when the tree cannot be read', async () => {
    const { browser } = build([
      { match: TREE, response: { status: 'http-error', statusCode: 500 } },
    ])

    expect(await browser.planSweep()).toEqual({
      status: 'unavailable',
      reason: 'category-tree',
    })
  })

  it('reports unavailable when the tree is not the shape promised', async () => {
    const { browser, logger } = build([
      { match: TREE, response: { status: 'ok', statusCode: 200, body: { data: 'nope' } } },
    ])

    expect(await browser.planSweep()).toEqual({ status: 'unavailable', reason: 'invalid-json' })
    expect(logger.find('vipcommerce.category_tree_unexpected')).toHaveLength(1)
  })
})

describe('VipCommerceCatalogBrowser fetching a page', () => {
  it('counts pages from one, where the sweep counts from zero', async () => {
    const { browser, http } = build([
      { match: DEPARTMENT, response: { status: 'ok', statusCode: 200, body: SHIBATA_CAFE } },
    ])

    await browser.fetchPage({ id: '3', label: 'Bebidas', size: 2771 }, 0)

    expect(http.lastUrl).toContain('/departamentos/3/produtos?page=1')
  })

  it('asks for a full page, because a department is swept not sampled', async () => {
    const { browser, http } = build([
      { match: DEPARTMENT, response: { status: 'ok', statusCode: 200, body: SHIBATA_CAFE } },
    ])

    await browser.fetchPage({ id: '3', label: 'Bebidas', size: 2771 }, 1)

    expect(http.lastUrl).toContain('page=2&limit=250')
  })

  it('maps a department page exactly as a keyword search does', async () => {
    const { browser } = build([
      { match: DEPARTMENT, response: { status: 'ok', statusCode: 200, body: SHIBATA_CAFE } },
    ])

    const result = await browser.fetchPage({ id: '3', label: 'Bebidas', size: 2771 }, 0)

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0]).toMatchObject({
      externalId: '38598',
      priceReais: 22.9,
      ean: '7891000621981',
    })
  })
})
