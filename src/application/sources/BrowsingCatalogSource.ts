import type { CatalogBrowser, CatalogSlice } from '../ports/CatalogBrowser'
import type { CatalogPage, CatalogSource } from '../ports/CatalogSource'
import type { Logger } from '../ports/Logger'

/**
 * Stop a slice after this many refusals in a row; stop the sweep after this
 * many slices fail outright. A store that has gone down, or an allowance
 * that has run out, should end the run rather than be asked 115 more times.
 */
const MAX_FAILED_SLICES = 5

/**
 * Reads a catalogue by walking the store's own category tree.
 *
 * Bounded by the shop's taxonomy instead of by our imagination, and far
 * cheaper per product: a Magento category page carries two hundred items
 * where a keyword search returns about thirty. For a store that asked us to
 * collect sparingly that is the difference between a complete catalogue and
 * a sample.
 */
export class BrowsingCatalogSource implements CatalogSource {
  readonly mode = 'categories' as const

  constructor(
    private readonly browser: CatalogBrowser,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.browser.storeId
  }

  /**
   * Complexity: one planning request, then O(p) requests for p pages across
   * every slice. Pages lazily, so memory stays at one page regardless of
   * catalogue size.
   */
  async *pages(): AsyncIterable<CatalogPage> {
    const plan = await this.browser.planSweep()

    if (plan.status !== 'ok') {
      yield { status: 'failed', label: `plan:${plan.reason}` }
      return
    }

    if (plan.unreachable.length > 0) {
      // A sweep that silently misses part of an aisle looks exactly like a
      // sweep that worked.
      this.logger.warn('sweep.partially_unreachable', {
        storeId: this.storeId,
        slices: plan.unreachable.length,
        products: plan.unreachable.reduce((total, slice) => total + slice.size, 0),
      })
    }

    let failedSlices = 0

    for (const slice of plan.slices) {
      const outcome = yield* this.pagesOf(slice)

      if (outcome === 'failed') {
        failedSlices += 1
        if (failedSlices >= MAX_FAILED_SLICES) {
          this.logger.warn('sweep.abandoned', {
            storeId: this.storeId,
            failedSlices,
          })
          return
        }
        continue
      }

      failedSlices = 0
    }
  }

  /**
   * Pages one slice to its end, or until the store stops answering.
   *
   * A page short of the page size is the store saying there is no more, so
   * the slice ends without spending a request to hear it say nothing. That
   * matters where the allowance is small: at Tauste a slice that fits in
   * one page used to cost two, which is about 115 wasted requests out of
   * the 231 the sweep needs against the 200 they asked us to keep to — so
   * the sweep ran out and abandoned the rest of the tree.
   *
   * The raw row count decides it, not the product count: the mapper drops
   * rows it cannot price, so a full page of 200 can arrive here as 180.
   * A browser that reports no count falls back to guessing from the
   * planner's size, which is the behaviour this replaces.
   */
  private async *pagesOf(slice: CatalogSlice): AsyncGenerator<CatalogPage, 'ok' | 'failed'> {
    // Rows gathered so far, against what the planner said the slice holds.
    let collected = 0
    // Whether the store has ever filled a window. Until it has, a short
    // page might mean it caps pages below what we ask for.
    let sawFullPage = false
    // Only used when the browser reports no row count: the old guess.
    let expectedPages = Number.POSITIVE_INFINITY

    for (let page = 0; page < expectedPages; page += 1) {
      const result = await this.browser.fetchPage(slice, page)

      if (result.status !== 'ok') {
        yield { status: 'failed', label: slice.label }
        return 'failed'
      }

      if (result.products.length === 0) return 'ok'

      yield { status: 'ok', label: slice.label, products: result.products }

      if (result.received === undefined) {
        // No row count to go on, so fall back to guessing from the first
        // page. One spare page, because counts drift.
        if (page === 0) {
          expectedPages = Math.ceil(slice.size / result.products.length) + 1
        }
        continue
      }

      collected += result.received

      if (result.received >= this.browser.pageSize) {
        sawFullPage = true

        // Still arriving full past the planner's count means the aisle grew
        // since it was sized. One spare page's worth, then stop, so a
        // category that answers forever cannot loop forever.
        if (collected >= slice.size + this.browser.pageSize) return 'ok'
        continue
      }

      // A short page ends the slice once we can be sure it means "no more"
      // rather than "this store caps its pages". Either the planner's whole
      // count is already in hand, or the store has filled a window before
      // and so is not capping. Asking again only to be told nothing is the
      // request this exists to stop buying.
      if (collected >= slice.size || sawFullPage) return 'ok'

      // Otherwise it is genuinely ambiguous — a store quietly capping its
      // page size looks exactly like one running out — so keep going. That
      // is what stops a cap from stranding the tail of every category.
    }

    return 'ok'
  }
}
