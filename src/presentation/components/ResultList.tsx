import Link from 'next/link'
import type { SearchResultItem } from '@/application/use-cases/SearchProducts'

/**
 * The listing.
 *
 * Each row answers one question — where is this cheapest and what does it
 * cost — and the price per unit sits next to it, because that is what settles
 * a comparison between a 350ml can and a 2L bottle.
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
          <Link
            href={`/produto/${item.productId}`}
            className="flex items-start justify-between gap-4 group"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-medium group-hover:underline underline-offset-2">
                {item.name}
              </span>

              <span className="text-xs text-ink-soft">
                {[item.brand, item.size].filter(Boolean).join(' · ')}
              </span>

              {item.cheapest ? (
                <span className="text-sm text-ink-soft">
                  mais barato no <span className="font-medium">{item.cheapest.storeName}</span>
                  {item.availableStoreCount > 1 && (
                    <span className="text-ink-soft">
                      {' '}
                      · {item.availableStoreCount} mercados têm
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-sm text-ink-soft">sem estoque nos mercados marcados</span>
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
