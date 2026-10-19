import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { OfferTable } from '@/presentation/components/OfferTable'
import { PostalCodeGate } from '@/presentation/components/PostalCodeGate'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

/**
 * Rendered per request, never prerendered.
 *
 * Every price on this page depends on the visitor's CEP and the stores they
 * picked, both of which come from their cookie, and the rate limiter needs
 * their request headers. There is no region-neutral version of this page to
 * cache, so blocking is the honest setting rather than a performance
 * oversight.
 */
export const instant = false

type Props = {
  params: Promise<{ id: string }>
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params
  const context = await readPageContext()

  if (context.status === 'needs-postal-code') {
    return <PostalCodeGate />
  }

  const result = await getWebContainer().getProductDetail.execute({
    productId: id,
    regionId: context.regionId,
    storeIds: context.pickedStoreIds,
    clientKey: clientKeyFromHeaders(await headers()),
  })

  if (result.status === 'not-found') notFound()

  return (
    <>
      <ContextBar
        postalCodeLabel={context.postalCodeLabel}
        regionId={context.regionId}
        stores={context.stores}
        picked={context.pickedStoreIds}
      />

      {result.status === 'ok' ? (
        <>
          <section className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {result.product.imageUrl ? (
              // Plain img: each store serves its photos from its own CDN,
              // and every one would need allowlisting for next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.product.imageUrl}
                alt=""
                className="product-photo h-44 w-44 shrink-0 self-center rounded-xl bg-surface object-contain sm:self-start"
              />
            ) : (
              <div className="flex h-44 w-44 shrink-0 items-center justify-center self-center rounded-xl bg-surface text-xs text-ink-faint sm:self-start">
                sem foto
              </div>
            )}

            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{result.product.name}</h1>
              <p className="text-sm text-ink-soft">
                {[result.product.brand, result.product.size].filter(Boolean).join(' · ')}
              </p>

              {result.spread && (
                <p className="text-sm text-accent">
                  Entre o mais barato e o mais caro dos mercados marcados dá{' '}
                  {result.spread.amountLabel} ({Math.round(result.spread.percent)}%).
                </p>
              )}

              {result.product.ean && (
                <p className="mt-1 text-xs text-ink-faint">Código de barras {result.product.ean}</p>
              )}
            </div>
          </section>

          <OfferTable offers={result.offers} />
        </>
      ) : (
        <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
          {result.status === 'no-offers' &&
            'Nenhum dos mercados marcados tem preço pra esse produto agora.'}
          {result.status === 'no-stores-selected' &&
            'Marque pelo menos um mercado ali em cima pra eu comparar.'}
          {result.status === 'rate-limited' &&
            `Muitas consultas em pouco tempo. Tente de novo em ${result.retryAfterSeconds}s.`}
        </p>
      )}

      <p className="text-sm text-ink-soft">
        <Link href="/" className="underline underline-offset-2">
          Nova busca
        </Link>
      </p>
    </>
  )
}
