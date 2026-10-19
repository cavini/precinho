import type {
  Address,
  AddressLookup,
  AddressLookupResult,
} from '@/application/ports/AddressLookup'
import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type { PostalCode } from '@/domain/value-objects/PostalCode'

const LOOKUP_TIMEOUT_MS = 6_000

/**
 * Resolves a CEP through ViaCEP.
 *
 * Free, no key, and somebody else's bandwidth — which is why the use case
 * rate-limits before calling here and why the timeout is short. A shopper
 * waiting on a CEP box will not wait fifteen seconds.
 */
export class ViaCepAddressLookup implements AddressLookup {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  /** Complexity: one request; O(1) mapping. */
  async byPostalCode(postalCode: PostalCode): Promise<AddressLookupResult> {
    const response = await this.http.getJson(
      `https://viacep.com.br/ws/${postalCode.digits}/json/`,
      { timeoutMs: LOOKUP_TIMEOUT_MS, headers: { Accept: 'application/json' } },
    )

    if (response.status === 'http-error') {
      // ViaCEP answers 400 for a CEP it cannot parse. We validate before
      // calling, so this is a CEP that does not exist rather than our bug.
      if (response.statusCode === 400 || response.statusCode === 404) {
        return { status: 'not-found' }
      }
      this.logger.warn('viacep.http_error', { statusCode: response.statusCode })
      return { status: 'unavailable' }
    }

    if (response.status !== 'ok') {
      this.logger.warn('viacep.unavailable', { result: response.status })
      return { status: 'unavailable' }
    }

    const address = toAddress(response.body)
    if (!address) {
      // Either the documented {"erro": "true"} or a shape we do not know.
      return { status: 'not-found' }
    }

    return { status: 'found', address }
  }
}

/**
 * Maps the ViaCEP body, or returns null when there is no address in it.
 *
 * The not-found marker is `"erro": "true"` — a string, not a boolean — so
 * both spellings are accepted in case that ever changes.
 */
function toAddress(body: unknown): Address | null {
  if (typeof body !== 'object' || body === null) return null
  const payload = body as Record<string, unknown>

  if (payload.erro === 'true' || payload.erro === true) return null

  const city = asText(payload.localidade)
  const uf = asText(payload.uf)
  if (!city || !uf) return null

  return {
    city,
    uf: uf.toUpperCase(),
    // ViaCEP sends an empty string for a CEP that covers a whole town.
    neighbourhood: asText(payload.bairro),
  }
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
