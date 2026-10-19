'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PostalCode } from '@/domain/value-objects/PostalCode'

type Props = {
  /** Shown when the shopper already has a CEP and is changing it. */
  current?: string
  onDone?: () => void
}

/**
 * The CEP field.
 *
 * Masking as they type and validating before submitting keeps a pointless
 * request off ViaCEP and gives a faster answer than a round trip would.
 * The same PostalCode value object does both here and on the server, so the
 * two can never disagree about what a CEP is.
 */
export function PostalCodeForm({ current, onDone }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const valid = PostalCode.tryParse(value) !== null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/contexto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep: value }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Não consegui usar esse CEP.')
        return
      }

      onDone?.()
      // The cookie is set; re-render the server components with it.
      router.refresh()
    } catch {
      setError('Sem conexão. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(PostalCode.mask(event.target.value))}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          aria-label="Seu CEP"
          aria-invalid={value.length > 0 && !valid}
          className="w-36 rounded-lg border border-zinc-300 bg-white px-3 py-2 tabular-nums
                     text-zinc-900 outline-none focus:border-zinc-900
                     dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300"
        />
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white
                     disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? 'Buscando…' : 'Usar'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  )
}
