import Link from 'next/link'
import { ProductImage } from './ProductImage'
import type { SearchResultItem } from '@/application/use-cases/SearchProducts'

/**
 * The search listing.
 *
 * Shaped like the feed card rather than a bare row: a product is easier to
 * recognise by its picture than by a name that runs to nine words of brand
 * and packaging. The blurb is clamped to two lines — some catalogues write
 * a sentence, others a page of marketing, and the row has to stay the same
 * height either way.
 */
export function ResultList({
  query,
  items,
}: {
  query: string
  items: readonly SearchResultItem[]
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        Não achei nada para <span className="font-medium">{query}</span> nos mercados marcados.
        Tente um termo mais simples, tipo <span className="font-medium">arroz</span>.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-rule">
      {items.map((item) => (
        <li key={item.productId} className="py-4">
          <Link href={`/produto/${item.productId}`} className="group flex items-start gap-4">
            <ProductImage src={item.imageUrl} className="h-20 w-20 shrink-0 rounded-lg" />

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium leading-snug group-hover:underline underline-offset-2">
                {item.name}
              </span>

              <span className="text-xs text-ink-soft">
                {[item.brand, item.size].filter(Boolean).join(' · ')}
              </span>

              {item.description && (
                <p className="line-clamp-2 text-xs leading-relaxed text-ink-faint">
                  {item.description}
                </p>
              )}

              {!item.cheapest && (
                <span className="text-sm text-ink-faint">sem estoque nos mercados marcados</span>
              )}

              {item.spread && (
                <span className="text-xs text-accent">
                  dá pra economizar {item.spread.amountLabel} ({Math.round(item.spread.percent)}%)
                </span>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-end">
              {item.cheapest && (
                <>
                  <span className="text-lg font-semibold tabular-nums">
                    {item.cheapest.priceLabel}
                  </span>
                  {item.cheapest.unitPriceLabel && (
                    <span className="text-xs tabular-nums text-ink-soft">
                      {item.cheapest.unitPriceLabel}
                    </span>
                  )}
                </>
              )}
            </div>
          </Link>

          {/*
            Outside the Link on purpose: a store link inside the card link
            would be an <a> inside an <a>, which is invalid HTML and makes
            React complain about hydration.
          */}
          {item.offers.length > 1 && (
            <ul className="mt-2 flex flex-col gap-1 pl-24">
              {item.offers.map((offer) => (
                <li key={offer.storeId} className="flex items-baseline justify-between gap-3">
                  <a
                    href={offer.url}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className={`truncate text-sm hover:underline underline-offset-2 ${
                      offer.isCheapest ? 'font-medium text-ink' : 'text-ink-soft'
                    }`}
                  >
                    {offer.storeName}
                  </a>

                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      offer.isCheapest ? 'font-semibold text-ink' : 'text-ink-soft'
                    }`}
                  >
                    {offer.priceLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
