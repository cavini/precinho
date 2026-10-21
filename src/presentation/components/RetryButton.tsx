'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Asks the server for this page again.
 *
 * A link to the same route would not do it — the client router answers
 * from its cache, so the reader would press "try again" and be shown the
 * same failure. router.refresh() re-runs the server render, which is the
 * thing that failed and the thing worth retrying.
 */
export function RetryButton({ label }: { label: string }) {
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)

  return (
    <button
      type="button"
      disabled={retrying}
      onClick={() => {
        setRetrying(true)
        router.refresh()
        // Cleared on its own, because a refresh that fails again should
        // leave the button usable rather than stuck.
        window.setTimeout(() => setRetrying(false), 4000)
      }}
      className="underline underline-offset-2 disabled:opacity-50"
    >
      {retrying ? 'Tentando…' : label}
    </button>
  )
}
