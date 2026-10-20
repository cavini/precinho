import { Suspense } from 'react'
import { ProductImage } from '@/presentation/components/ProductImage'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { OfferTable } from '@/presentation/components/OfferTable'
import { PostalCodeGate } from '@/presentation/components/PostalCodeGate'
import { ContextBarSkeleton, ProductDetailSkeleton } from '@/presentation/components/Skeletons'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

type Props = {
  params: Promise<{ id: string }>
}

export default function ProductPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <>
          <ContextBarSkeleton />
          <ProductDetailSkeleton />
        </>
      }
    >
      <ProductBody params={params} />
    </Suspense>
  )
}

async function ProductBody({ params }: Props) {
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
            <ProductImage
              src={result.product.imageUrl}
              className="h-44 w-44 shrink-0 self-center rounded-xl sm:self-start"
              iconClassName="h-12 w-12"
            />

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
