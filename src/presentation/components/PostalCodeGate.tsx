import { PostalCodeForm } from './PostalCodeForm'

/**
 * What a first-time visitor sees.
 *
 * The CEP comes first because every price on the site depends on it: online
 * grocery prices are regional, so there is no neutral price to show while
 * waiting for one.
 */
export function PostalCodeGate() {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-rule p-6">
      <h2 className="text-xl font-semibold tracking-tight">Qual é o seu CEP?</h2>
      <p className="max-w-prose text-sm text-ink-soft">
        Preço de mercado muda de região. Com o CEP eu mostro o que as lojas que atendem você estão
        cobrando hoje.
      </p>
      <PostalCodeForm />
    </section>
  )
}
