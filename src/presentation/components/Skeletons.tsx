/**
 * Loading placeholders.
 *
 * Each one mirrors the shape of what replaces it — same heights, same
 * column widths, same gaps — so the page does not jump when the real
 * content lands. A skeleton that is the wrong size is worse than a spinner,
 * because it promises a layout and then breaks it.
 *
 * `animate-pulse` only; no spinners. These sit behind Suspense boundaries
 * that usually resolve in well under a second, and a spinner at that
 * duration reads as slower than a quiet shimmer.
 */

function Bar({ className = '' }: { className?: string }) {
  return <span className={`block rounded bg-rule ${className}`} aria-hidden="true" />
}

/** The CEP line and store chips at the top of every page. */
export function ContextBarSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 border-b border-rule pb-4">
      <div className="flex items-center gap-2">
        <Bar className="h-4 w-28" />
        <Bar className="h-4 w-20" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Bar className="h-4 w-20" />
        {['w-20', 'w-24', 'w-16', 'w-28', 'w-20'].map((width, index) => (
          <Bar key={index} className={`h-7 rounded-full ${width}`} />
        ))}
      </div>
    </div>
  )
}

/** One feed card: picture, two lines of text, then the store list. */
function CardSkeleton() {
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-surface">
      <div className="flex flex-col gap-3 p-4">
        <Bar className="h-36 w-full rounded-xl" />
        <div className="flex flex-col gap-1.5">
          <Bar className="h-4 w-11/12" />
          <Bar className="h-3 w-1/3" />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-rule px-4 py-3">
        <Bar className="h-3 w-32" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-3">
            <Bar className="h-3 w-24" />
            <Bar className="h-3 w-14" />
          </div>
        ))}
      </div>
    </li>
  )
}

export function FeedSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <section className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando ofertas">
      <Bar className="h-3 w-48 animate-pulse" />
      <ul className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: cards }, (_, index) => (
          <CardSkeleton key={index} />
        ))}
      </ul>
    </section>
  )
}

/** The search listing: one row per product, price on the right. */
export function ResultListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul
      className="flex animate-pulse flex-col divide-y divide-rule"
      aria-busy="true"
      aria-label="Buscando"
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-start gap-4 py-4">
          <Bar className="h-20 w-20 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Bar className="h-4 w-2/3" />
            <Bar className="h-3 w-1/4" />
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-2/5" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Bar className="h-5 w-20" />
            <Bar className="h-3 w-14" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The product page: photo beside the name, then the price table. */
export function ProductDetailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Carregando produto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Bar className="h-44 w-44 shrink-0 self-center rounded-xl sm:self-start" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Bar className="h-7 w-4/5" />
          <Bar className="h-4 w-1/3" />
          <Bar className="h-4 w-3/5" />
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-rule">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <Bar className="h-4 w-28" />
              <Bar className="h-3 w-36" />
            </div>
            <div className="flex items-center gap-4">
              <Bar className="h-5 w-16" />
              <Bar className="h-8 w-24 rounded-lg" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
