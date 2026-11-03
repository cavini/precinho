import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { ProductImage } from './ProductImage'
import type { FeedCard } from '@/application/use-cases/GetProductFeed'

/**
 * The home feed.
 *
 * A search box on an empty page asks the visitor to already know what they
 * want. These cards answer the question the app exists for without being
 * asked: here is something you are overpaying for, and here is where it is
 * cheaper.
 */
export function ProductFeed({ cards }: { cards: readonly FeedCard[] }) {
  const t = useTranslations('Feed')

  if (cards.length === 0) {
    return <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">{t('empty')}</p>
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-ink-soft">
        {t('subheading')}
      </h2>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <li
            key={card.productId}
            className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-surface"
          >
            <Link
              href={{ pathname: '/product/[id]', params: { id: card.productId } }}
              className="group flex flex-col gap-3 p-4"
            >
              <ProductImage
                src={card.imageUrl}
                className="h-36 w-full self-center"
                iconClassName="h-10 w-10"
              />

              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-snug group-hover:underline underline-offset-2">
                  {card.name}
                </span>
                <span className="text-xs text-ink-soft">
                  {[card.brand, card.size].filter(Boolean).join(' · ')}
                </span>
              </div>
            </Link>

            <div className="flex flex-col gap-2 border-t border-rule px-4 py-3">
              <span className="text-xs font-medium text-accent">
                {t('saveUpTo', { amount: card.savingsLabel })}
              </span>

              <ul className="flex flex-col gap-1">
                {card.offers.map((offer) => (
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

              {card.unitPriceLabel && (
                <span className="text-xs tabular-nums text-ink-soft">
                  {t('atTheCheapest', { unitPrice: card.unitPriceLabel })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
