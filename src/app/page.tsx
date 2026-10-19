import { ContextBar } from '@/presentation/components/ContextBar'
import { PostalCodeGate } from '@/presentation/components/PostalCodeGate'
import { SearchForm } from '@/presentation/components/SearchForm'
import { readPageContext } from '@/presentation/server/shoppingContext'

/**
 * Rendered per request, never prerendered.
 *
 * Every price on this page depends on the visitor's CEP and the stores they
 * picked, both of which come from their cookie, and the rate limiter needs
 * their request headers. There is no region-neutral version of this page to
 * cache, so blocking is the honest setting rather than a performance
 * oversight.
 */
export const instant = false

export default async function HomePage() {
  const context = await readPageContext()

  if (context.status === 'needs-postal-code') {
    return <PostalCodeGate />
  }

  return (
    <>
      <ContextBar
        postalCodeLabel={context.postalCodeLabel}
        regionId={context.regionId}
        stores={context.stores}
        picked={context.pickedStoreIds}
      />

      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          O que você quer comparar?
        </h1>
        <SearchForm autoFocus />
      </section>
    </>
  )
}
