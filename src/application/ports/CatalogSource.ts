import type { CatalogProduct } from "./StoreCatalogGateway";

/**
 * One unit of a sweep: a search term's results, or a page of a category.
 *
 * Failures are a page like any other rather than an exception, because a
 * run is expected to be partly broken — a store rate-limits, changes its
 * API, or goes down halfway — and a sweep that aborts on the first refusal
 * throws away everything it had already found.
 */
export type CatalogPage =
  | { status: "ok"; label: string; products: readonly CatalogProduct[] }
  | { status: "failed"; label: string };

/**
 * Where a collection run gets its products.
 *
 * Exists so the ingestion — parse, match, dedupe, write — is written once
 * and knows nothing about whether the products arrived from a list of
 * search terms or from walking a category tree. Adding a third way to read
 * a catalogue should not touch CollectStoreOffers at all.
 */
export interface CatalogSource {
  readonly storeId: string;
  /** How the catalogue is being read; goes in the run report. */
  readonly mode: "terms" | "categories";
  /** Lazily, because a category sweep is hundreds of requests long. */
  pages(): AsyncIterable<CatalogPage>;
}
