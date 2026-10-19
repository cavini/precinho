import type { CatalogBrowser, CatalogSlice } from "../ports/CatalogBrowser";
import type { CatalogPage, CatalogSource } from "../ports/CatalogSource";
import type { Logger } from "../ports/Logger";

/**
 * Stop a slice after this many refusals in a row; stop the sweep after this
 * many slices fail outright. A store that has gone down, or an allowance
 * that has run out, should end the run rather than be asked 115 more times.
 */
const MAX_FAILED_SLICES = 5;

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
  readonly mode = "categories" as const;

  constructor(
    private readonly browser: CatalogBrowser,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.browser.storeId;
  }

  /**
   * Complexity: one planning request, then O(p) requests for p pages across
   * every slice. Pages lazily, so memory stays at one page regardless of
   * catalogue size.
   */
  async *pages(): AsyncIterable<CatalogPage> {
    const plan = await this.browser.planSweep();

    if (plan.status !== "ok") {
      yield { status: "failed", label: `plan:${plan.reason}` };
      return;
    }

    if (plan.unreachable.length > 0) {
      // A sweep that silently misses part of an aisle looks exactly like a
      // sweep that worked.
      this.logger.warn("sweep.partially_unreachable", {
        storeId: this.storeId,
        slices: plan.unreachable.length,
        products: plan.unreachable.reduce(
          (total, slice) => total + slice.size,
          0,
        ),
      });
    }

    let failedSlices = 0;

    for (const slice of plan.slices) {
      const outcome = yield* this.pagesOf(slice);

      if (outcome === "failed") {
        failedSlices += 1;
        if (failedSlices >= MAX_FAILED_SLICES) {
          this.logger.warn("sweep.abandoned", {
            storeId: this.storeId,
            failedSlices,
          });
          return;
        }
        continue;
      }

      failedSlices = 0;
    }
  }

  /** Pages one slice to its end, or until the store stops answering. */
  private async *pagesOf(
    slice: CatalogSlice,
  ): AsyncGenerator<CatalogPage, "ok" | "failed"> {
    // Learned from the first page rather than assumed, so a store that
    // quietly caps page size cannot strand the tail of a category.
    let expectedPages = Number.POSITIVE_INFINITY;

    for (let page = 0; page < expectedPages; page += 1) {
      const result = await this.browser.fetchPage(slice, page);

      if (result.status !== "ok") {
        yield { status: "failed", label: slice.label };
        return "failed";
      }

      if (result.products.length === 0) return "ok";

      if (page === 0) {
        // One spare page: counts drift, and an extra empty request is
        // cheaper than leaving products behind.
        expectedPages = Math.ceil(slice.size / result.products.length) + 1;
      }

      yield { status: "ok", label: slice.label, products: result.products };
    }

    return "ok";
  }
}
