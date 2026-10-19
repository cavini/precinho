import Link from 'next/link'
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
            {item.imageUrl ? (
              // Plain img: each chain serves photos from its own CDN, and
              // every one would need allowlisting for next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="product-photo h-20 w-20 shrink-0 rounded-lg bg-surface object-contain"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface text-[10px] text-ink-faint">
                sem foto
              </div>
            )}

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

              {item.cheapest ? (
                <span className="text-sm text-ink-soft">
                  mais barato no <span className="font-medium">{item.cheapest.storeName}</span>
                  {item.availableStoreCount > 1 && (
                    <span className="text-ink-faint"> · {item.availableStoreCount} mercados têm</span>
                  )}
                </span>
              ) : (
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
        </li>
      ))}
    </ul>
  )
}
