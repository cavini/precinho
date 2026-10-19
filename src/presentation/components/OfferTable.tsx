import type { ProductDetailOffer } from '@/application/use-cases/GetProductDetail'

/**
 * Every store's price for one product, with the link.
 *
 * The link is the point of the screen — a comparison nobody can act on is
 * trivia. `rel="nofollow noopener"` because these are outbound links to third
 * parties, opened in a new tab so the comparison stays put behind them.
 *
 * Collection time is shown, and shown as a warning once it is stale, because
 * an old price presented as today's is worse than no price.
 */
export function OfferTable({ offers }: { offers: readonly ProductDetailOffer[] }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {offers.map((offer) => (
        <li
          key={offer.storeId}
          className={`flex items-center justify-between gap-4 py-3 ${
            offer.inStock ? '' : 'opacity-50'
          }`}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              {offer.storeName}
              {offer.isCheapest && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                  mais barato
                </span>
              )}
            </span>

            <span className="text-xs text-zinc-500">
              {offer.inStock ? <Collected at={offer.collectedAt} stale={offer.isStale} /> : 'sem estoque'}
            </span>

            {offer.discount && (
              <span className="text-xs text-zinc-500">
                promoção da loja: {offer.discount.amountLabel} off
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="font-semibold tabular-nums">{offer.priceLabel}</span>
              {offer.unitPriceLabel && (
                <span className="text-xs tabular-nums text-zinc-500">{offer.unitPriceLabel}</span>
              )}
            </div>

            <a
              href={offer.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-300"
            >
              ver na loja
            </a>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Collected({ at, stale }: { at: string; stale: boolean }) {
  const label = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at))

  if (stale) {
    return (
      <span className="text-amber-700 dark:text-amber-500">
        preço de {label} — pode ter mudado
      </span>
    )
  }
  return <>coletado em {label}</>
}
