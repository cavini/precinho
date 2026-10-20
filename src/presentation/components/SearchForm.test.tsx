// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchForm } from './SearchForm'

const push = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}))

/** Puts the browser somewhere, the way a navigation would. */
function at(query: string) {
  searchParams = new URLSearchParams(query ? `q=${encodeURIComponent(query)}` : '')
}

const box = () => screen.getByLabelText('Buscar produto') as HTMLInputElement

beforeEach(() => {
  push.mockClear()
  at('')
})

describe('SearchForm', () => {
  it('opens showing whatever the address bar is asking for', () => {
    at('cafe')
    render(<SearchForm />)

    expect(box().value).toBe('cafe')
  })

  it('searches what was typed', async () => {
    render(<SearchForm />)
    await userEvent.type(box(), 'detergente')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    expect(push).toHaveBeenCalledWith('/busca?q=detergente')
  })

  it('follows the browser going back to an earlier search', () => {
    // Back from ?q=cafe to ?q=detergente used to leave "cafe" in the box,
    // so pressing enter searched a term from the page before.
    at('cafe')
    const { rerender } = render(<SearchForm />)
    expect(box().value).toBe('cafe')

    at('detergente')
    rerender(<SearchForm />)

    expect(box().value).toBe('detergente')
  })

  it('empties when the browser lands somewhere with no query', () => {
    // The home page. A term left sitting there belongs to a page the
    // reader has left.
    at('detergente')
    const { rerender } = render(<SearchForm />)

    at('')
    rerender(<SearchForm />)

    expect(box().value).toBe('')
  })

  it('does not throw away typing on an unrelated re-render', async () => {
    render(<SearchForm />)
    await userEvent.type(box(), 'macarr')

    const { rerender } = { rerender: () => {} }
    void rerender

    expect(box().value).toBe('macarr')
  })

  it('refuses a query the server would reject', async () => {
    // One letter is below SearchQuery's minimum, so the request never
    // leaves the browser.
    render(<SearchForm />)
    await userEvent.type(box(), 'a')

    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled()
  })

  it('escapes a query on its way into the URL', async () => {
    render(<SearchForm />)
    await userEvent.type(box(), 'leite & cia')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    expect(push).toHaveBeenCalledWith('/busca?q=leite%20%26%20cia')
  })
})
