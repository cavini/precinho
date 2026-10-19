import type { PostalCode } from '@/domain/value-objects/PostalCode'

export type Address = {
  city: string
  /** Two-letter state code. */
  uf: string
  /** Shown back to the shopper so they can see the CEP resolved correctly. */
  neighbourhood: string | null
}

export type AddressLookupResult =
  | { status: 'found'; address: Address }
  /** A well-formed CEP that has no address behind it. */
  | { status: 'not-found' }
  /** The upstream service failed or timed out — distinct from not-found, because it is our problem, not the shopper's. */
  | { status: 'unavailable' }

/**
 * Turns a CEP into a place. Implemented against ViaCEP, but nothing above
 * this port knows that.
 */
export interface AddressLookup {
  byPostalCode(postalCode: PostalCode): Promise<AddressLookupResult>
}
