import type { CatalogPage, CatalogSource } from '../ports/CatalogSource'
import type { StoreCatalogGateway } from '../ports/StoreCatalogGateway'

/**
 * Reads a catalogue by asking for a list of words.
 *
 * Only ever finds what somebody thought to type: the app returned nothing
 * for "azeite" purely because the word was not on the list. Still the right
 * source for a store whose category endpoint cannot be trusted — Tenda's
 * duplicates rows and terminates early.
 */
export class TermCatalogSource implements CatalogSource {
  readonly mode = 'terms' as const

  constructor(
    private readonly gateway: StoreCatalogGateway,
    private readonly terms: readonly string[],
  ) {}

  get storeId(): string {
    return this.gateway.storeId
  }

  /** Complexity: O(t) requests for t terms. */
  async *pages(): AsyncIterable<CatalogPage> {
    for (const term of this.terms) {
      const result = await this.gateway.searchTerm(term)

      yield result.status === 'ok'
        ? { status: 'ok', label: term, products: result.products }
        : { status: 'failed', label: term }
    }
  }
}
