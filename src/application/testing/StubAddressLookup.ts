import type { PostalCode } from '@/domain/value-objects/PostalCode'
import type { Address, AddressLookup, AddressLookupResult } from '../ports/AddressLookup'

/**
 * Resolves only the CEPs a test puts in it; anything else is not-found.
 * Set `failWith` to exercise the upstream-unavailable path.
 */
export class StubAddressLookup implements AddressLookup {
  readonly asked: string[] = []
  failWith: 'unavailable' | null = null

  constructor(private readonly known: Record<string, Address> = {}) {}

  async byPostalCode(postalCode: PostalCode): Promise<AddressLookupResult> {
    this.asked.push(postalCode.digits)
    if (this.failWith) return { status: this.failWith }

    const address = this.known[postalCode.digits]
    return address ? { status: 'found', address } : { status: 'not-found' }
  }
}
