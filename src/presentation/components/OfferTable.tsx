import type { Locale } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ProductDetailOffer } from '@/application/use-cases/GetProductDetail'
import { LOCALE_TAG } from '@/i18n/config'

/**
 * Every store's price for one product, with the link.
 *
 * The link is the point of the screen — a comparison nobody can act on is
 * trivia. `rel="nofollow noopener"` because these are outbound links to third
 * parties, opened in a new tab so the comparison stays put behind them.
 *
 * Collection time is shown, and shown as a warning once it is stale, because
 * an old price presented as today's is worse than no price.
 *
 * Rendered only on the server, so it awaits its translations rather than
 * taking them from a provider the way the client leaves do.
 */
export async function OfferTable({ offers }: { offers: readonly ProductDetailOffer[] }) {
  const t = await getTranslations('Product')
  const locale = await getLocale()

  return (
    <ul className="flex flex-col divide-y divide-rule">
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
                <span className="rounded-full bg-accent-wash px-2 py-0.5 text-xs font-medium text-accent">
                  {t('cheapest')}
                </span>
              )}
            </span>

            <span className="text-xs text-ink-soft">
              {offer.inStock ? (
                <Collected at={offer.collectedAt} stale={offer.isStale} locale={locale} />
              ) : (
                t('outOfStock')
              )}
            </span>

            {offer.discount && (
              <span className="text-xs text-ink-soft">
                {t('promotion', { amount: offer.discount.amountLabel })}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="font-semibold tabular-nums">{offer.priceLabel}</span>
              {offer.unitPriceLabel && (
                <span className="text-xs tabular-nums text-ink-soft">{offer.unitPriceLabel}</span>
              )}
            </div>

            <a
              href={offer.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="rounded-lg border border-rule-strong px-3 py-1.5 text-sm hover:border-ink"
            >
              {t('viewAtStore')}
            </a>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * The date follows the interface's language, not the shop's.
 *
 * "01/11 14:30" read by somebody who has chosen English is the eleventh of
 * January, which is a different day from the one we collected. Prices
 * themselves stay in reais written the Brazilian way, because that is what
 * the shop charges rather than a convention of the reader's.
 *
 * Formatted here rather than through next-intl's formatter, which wants a
 * configured time zone. The server's is what this has always used, and a
 * language switch is the wrong change to move every timestamp in.
 */
async function Collected({ at, stale, locale }: { at: string; stale: boolean; locale: Locale }) {
  const t = await getTranslations('Product')

  const when = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at))

  if (stale) {
    return <span className="text-warn">{t('stale', { when })}</span>
  }
  return <>{t('collectedAt', { when })}</>
}
