import { NextResponse } from 'next/server'
import { getWebContainer } from '@/composition/container'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import {
  PREFERENCES_COOKIE,
  PREFERENCES_MAX_AGE_SECONDS,
  serializePreferences,
} from '@/presentation/preferences'

/**
 * Resolves a CEP and remembers it.
 *
 * The only write the website does, and it writes a cookie rather than a row —
 * there is no login, so there is nobody for a stored preference to belong to.
 *
 * Every store in the region starts picked. Somebody who has just arrived has
 * not ruled anything out, and showing them one chain would hide the
 * comparison that is the point of the site.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { resolveShoppingContext } = getWebContainer()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'corpo inválido' }, { status: 400 })
  }

  const rawPostalCode =
    typeof body === 'object' && body !== null && 'cep' in body
      ? String((body as { cep: unknown }).cep ?? '')
      : ''

  const result = await resolveShoppingContext.execute({
    rawPostalCode,
    clientKey: clientKeyFromHeaders(request.headers),
  })

  switch (result.status) {
    case 'ok': {
      const response = NextResponse.json({
        cep: result.context.postalCode,
        cidade: result.context.city,
        uf: result.context.uf,
        bairro: result.context.neighbourhood,
        cobertura: result.context.coverage,
        regiao: result.context.region.name,
        lojas: result.context.stores,
      })

      response.cookies.set({
        name: PREFERENCES_COOKIE,
        value: serializePreferences({
          postalCode: result.context.postalCode.replace(/\D/g, ''),
          regionId: result.context.region.id,
          storeIds: result.context.stores.map((store) => store.id),
        }),
        maxAge: PREFERENCES_MAX_AGE_SECONDS,
        // Readable by the store picker, which toggles chips without a round
        // trip. There is nothing secret in it.
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      })

      return response
    }

    case 'invalid-postal-code':
      return NextResponse.json({ error: 'CEP inválido. Confira os 8 dígitos.' }, { status: 400 })

    case 'postal-code-not-found':
      return NextResponse.json({ error: 'Não encontrei esse CEP.' }, { status: 404 })

    case 'no-coverage':
      return NextResponse.json(
        {
          error: `Ainda não tenho lojas em ${result.city}, ${result.uf}.`,
          semCobertura: true,
        },
        { status: 404 },
      )

    case 'rate-limited':
      return NextResponse.json(
        { error: 'Muitas consultas. Tente de novo em instantes.' },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      )

    case 'lookup-failed':
      // Ours, not theirs — and the status code should say so.
      return NextResponse.json(
        { error: 'O serviço de CEP está fora do ar. Tente de novo em instantes.' },
        { status: 503 },
      )
  }
}
