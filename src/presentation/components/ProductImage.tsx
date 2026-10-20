'use client'

import { useState } from 'react'

/**
 * A catalogue photo, or something worth looking at when there is not one.
 *
 * Two failure modes, not one. Plenty of rows carry no image at all, and
 * plenty carry a URL that 404s — a chain reorganises its CDN and every link
 * we stored that morning goes stale. The second kind renders as the
 * browser's broken-image glyph, which looks like the app is broken rather
 * than the photo, so both end at the same placeholder.
 *
 * A client component for exactly one reason: onError cannot be observed on
 * the server, and a broken photo is only discovered when it fails to load.
 */
export function ProductImage({
  src,
  className,
  iconClassName,
}: {
  src: string | null
  /** Sizing comes from the caller: the feed wants a tall card, search a thumb. */
  className: string
  iconClassName?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-ground ${className}`}
        // The photo carries no information the name does not, so it is
        // decorative; a screen reader should skip it rather than announce
        // "image placeholder" on every row.
        aria-hidden="true"
      >
        <BasketIcon className={iconClassName ?? 'h-8 w-8'} />
      </div>
    )
  }

  return (
    // Plain img: each chain serves photos from its own CDN, and every one
    // would need allowlisting in next.config for the Image component.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`product-photo object-contain ${className}`}
    />
  )
}

/**
 * A shopping basket, drawn rather than imported: one icon does not justify
 * a dependency, and an inline SVG inherits the text colour so it sits in
 * the palette instead of fighting it.
 */
function BasketIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-ink-faint ${className}`}
    >
      <path d="M5.5 9h13l-1.2 8.3a2 2 0 0 1-2 1.7H8.7a2 2 0 0 1-2-1.7L5.5 9Z" />
      <path d="M9 9 10.5 5" />
      <path d="M15 9 13.5 5" />
      <path d="M9.8 12.5v3" />
      <path d="M14.2 12.5v3" />
    </svg>
  )
}
