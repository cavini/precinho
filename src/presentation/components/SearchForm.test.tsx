// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inLanguage } from '@/testing/intl'
import { SearchForm } from './SearchForm'

/** Resolves only when a test lets it, so the pending state can be seen. */
let finishNavigation: () => void = () => {}
const push = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      finishNavigation = resolve
    }),
)
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }))

// The locale-aware router, which is what the form navigates through: a
// plain next/link push would drop an English reader back into Portuguese.
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }))

/** Puts the browser somewhere, the way a navigation would. */
function at(query: string) {
  searchParams = new URLSearchParams(query ? `q=${encodeURIComponent(query)}` : '')
}

const box = () => screen.getByLabelText('Buscar produto') as HTMLInputElement

beforeEach(() => {
  // A navigation left hanging by the previous test keeps React's
  // transition lane busy, and the next test's spinner then never clears.
  // Only shows up when the file runs in order, which is how it bit.
  finishNavigation()

  push.mockClear()
  finishNavigation = () => {}
  at('')
})

describe('SearchForm', () => {
  it('opens showing whatever the address bar is asking for', () => {
    at('cafe')
    render(inLanguage(<SearchForm />))

    expect(box().value).toBe('cafe')
  })

  it('searches what was typed', async () => {
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'detergente')
    await userEvent.click(screen.getByRole('button'))

    expect(push).toHaveBeenCalledWith({ pathname: '/search', query: { q: 'detergente' } })
  })

  it('follows the browser going back to an earlier search', () => {
    // Back from ?q=cafe to ?q=detergente used to leave "cafe" in the box,
    // so pressing enter searched a term from the page before.
    at('cafe')
    const { rerender } = render(inLanguage(<SearchForm />))
    expect(box().value).toBe('cafe')

    at('detergente')
    rerender(inLanguage(<SearchForm />))

    expect(box().value).toBe('detergente')
  })

  it('empties when the browser lands somewhere with no query', () => {
    // The home page. A term left sitting there belongs to a page the
    // reader has left.
    at('detergente')
    const { rerender } = render(inLanguage(<SearchForm />))

    at('')
    rerender(inLanguage(<SearchForm />))

    expect(box().value).toBe('')
  })

  it('does not throw away typing on an unrelated re-render', async () => {
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'macarr')

    const { rerender } = { rerender: () => {} }
    void rerender

    expect(box().value).toBe('macarr')
  })

  it('disables itself while a search is in flight', async () => {
    // The navigation is a server render, so the results are fetched
    // before the page arrives. A second press in that window fires a
    // second search.
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'detergente')
    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('says it is searching, because a cold start takes seconds', async () => {
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'detergente')
    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveTextContent('Buscando')
  })

  it('searches once however many times the button is pressed', async () => {
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'detergente')

    const button = screen.getByRole('button')
    await userEvent.click(button)
    await userEvent.click(button)
    await userEvent.click(button)

    expect(push).toHaveBeenCalledTimes(1)
  })

  it('becomes usable again once the search lands', async () => {
    // A button that stays disabled after the results arrive is worse than
    // one that was never disabled: the next search needs a page reload.
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'detergente')
    await userEvent.click(screen.getByRole('button'))

    finishNavigation()

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
    expect(screen.getByRole('button')).toHaveTextContent('Buscar')
  })

  it('refuses a query the server would reject', async () => {
    // One letter is below SearchQuery's minimum, so the request never
    // leaves the browser.
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'a')

    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('hands the term over untouched, for the router to escape', async () => {
    // Escaping used to happen here, in a hand-built URL. The typed router
    // owns it now — along with deciding whether the path is /busca or
    // /en/search — so what this guards is that nothing mangles the term
    // on the way, which a stray encode on top of the router's would.
    render(inLanguage(<SearchForm />))
    await userEvent.type(box(), 'leite & cia')
    await userEvent.click(screen.getByRole('button'))

    expect(push).toHaveBeenCalledWith({ pathname: '/search', query: { q: 'leite & cia' } })
  })
})
