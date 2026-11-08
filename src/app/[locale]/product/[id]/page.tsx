import { Suspense } from 'react'
import { RetryButton } from '@/presentation/components/RetryButton'
import { ProductImage } from '@/presentation/components/ProductImage'
import { headers } from 'next/headers'
import { connection } from 'next/server'
import { Link } from '@/i18n/navigation'
import { notFound } from 'next/navigation'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { OfferTable } from '@/presentation/components/OfferTable'
import { ContextBarSkeleton, ProductDetailSkeleton } from '@/presentation/components/Skeletons'
import { getTranslations } from 'next-intl/server'
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
  // See the note in search/page.tsx: without this the partial prerender
  // cancels the query mid-flight and the cancellation arrives as an
  // ordinary database error.
  await connection()

  const { id } = await params
  const common = await getTranslations('Common')
  const t = await getTranslations('Product')
  const context = await readPageContext()

  if (context.status === 'unavailable') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        {common('unavailable')} <RetryButton label={common('retry')} />
      </p>
    )
  }

  if (context.status === 'no-coverage') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        {common('noCoverage')}
      </p>
    )
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
        regionName={context.regionName}
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
                  {t('spread', {
                    amount: result.spread.amountLabel,
                    percent: Math.round(result.spread.percent),
                  })}
                </p>
              )}

              {result.product.ean && (
                <p className="mt-1 text-xs text-ink-faint">
                  {t('barcode', { ean: result.product.ean })}
                </p>
              )}
            </div>
          </section>

          <OfferTable offers={result.offers} />
        </>
      ) : (
        <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
          {result.status === 'no-offers' && t('noOffers')}
          {result.status === 'no-stores-selected' && common('noStoresSelected')}
          {result.status === 'rate-limited' &&
            common('rateLimited', { seconds: result.retryAfterSeconds })}
        </p>
      )}

      <p className="text-sm text-ink-soft">
        <Link href="/" className="underline underline-offset-2">
          {t('newSearch')}
        </Link>
      </p>
    </>
  )
}
