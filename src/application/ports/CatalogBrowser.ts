import type { CatalogSearchResult } from './StoreCatalogGateway'

/**
 * A slice of a catalogue small enough to page through to the end.
 *
 * Platforms cap how deep paging can go — VTEX refuses an offset past 2,500 —
 * so a catalogue is swept as a set of slices that each fit under the cap,
 * not as one long list.
 */
export type CatalogSlice = {
  /** Platform-specific handle, e.g. a VTEX category path. */
  id: string
  /** Readable name, for logs and reports. */
  label: string
  /** How many products it is expected to hold. */
  size: number
}

export type SweepPlan =
  | {
      status: 'ok'
      slices: readonly CatalogSlice[]
      /**
       * Slices that are still over the platform's ceiling after descending
       * as far as the tree goes, so part of them is unreachable.
       *
       * Reported rather than dropped quietly: a sweep that silently misses
       * a third of an aisle looks exactly like a sweep that worked.
       */
      unreachable: readonly CatalogSlice[]
      /** Requests spent working the plan out, for the run report. */
      requestsSpent: number
    }
  | { status: 'unavailable'; reason: string }

/**
 * Walks a whole catalogue rather than sampling it with search terms.
 *
 * Keyword sweeps only ever find what somebody thought to ask for — the app
 * returned nothing for "azeite" purely because the word was not on the list.
 * Browsing categories is bounded by the store's own taxonomy instead of by
 * our imagination.
 *
 * Separate from StoreCatalogGateway because not every platform can do it:
 * Tenda's category endpoint duplicates rows, terminates early and surfaces
 * nothing its search does not already return, so Tenda implements the
 * gateway and not this.
 */
export interface CatalogBrowser {
  readonly storeId: string

  /**
   * Rows this browser asks for per page.
   *
   * Stated so a short page can be recognised as the end of a slice without
   * spending a request to confirm it.
   */
  readonly pageSize: number

  /** Splits the catalogue into slices that each fit under the paging cap. */
  planSweep(): Promise<SweepPlan>

  /** One page of a slice. An empty product list ends it. */
  fetchPage(slice: CatalogSlice, page: number): Promise<CatalogSearchResult>
}
