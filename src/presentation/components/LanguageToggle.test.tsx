// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inLanguage } from '@/testing/intl'
import { LanguageToggle } from './LanguageToggle'

const replace = vi.fn()
let pathname = '/search'
let params: Record<string, string> = {}

// The locale-aware navigation, which is what the switch moves through.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => pathname,
}))

vi.mock('next/navigation', () => ({ useParams: () => params }))

beforeEach(() => {
  replace.mockClear()
  pathname = '/search'
  params = {}
  window.history.replaceState({}, '', '/busca')
})

const button = (name: string) => screen.getByRole('button', { name })

describe('LanguageToggle', () => {
  it('names each language in its own words', () => {
    // Somebody who cannot read the page they landed on is looking for the
    // word "Português", not for whatever the current language calls it.
    render(inLanguage(<LanguageToggle />, 'en'))

    expect(button('Português')).toBeInTheDocument()
    expect(button('English')).toBeInTheDocument()
  })

  it('says which language the page is already in', () => {
    render(inLanguage(<LanguageToggle />, 'pt'))

    expect(button('Português')).toHaveAttribute('aria-pressed', 'true')
    expect(button('English')).toHaveAttribute('aria-pressed', 'false')
  })

  it('moves to the same page in the other language', async () => {
    // Not to the home page, and not to a reload: the language is part of
    // the address now, so switching it is a navigation to here.
    render(inLanguage(<LanguageToggle />, 'pt'))
    await userEvent.click(button('English'))

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/search' }), {
      locale: 'en',
    })
  })

  it('carries the search term across the switch', async () => {
    // Switching language in the middle of a search should not throw the
    // search away. Read from the address bar rather than through
    // useSearchParams, which is a dynamic hook: subscribing to it would
    // make the header — and so every page's prerendered shell — wait on a
    // request. The term is only wanted at the moment of the press.
    window.history.replaceState({}, '', '/busca?q=arroz')
    render(inLanguage(<LanguageToggle />, 'pt'))
    await userEvent.click(button('English'))

    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ query: { q: 'arroz' } }), {
      locale: 'en',
    })
  })

  it('keeps a product on screen rather than dropping to the listing', async () => {
    // The dynamic segment has to survive, or reading a product in English
    // means finding it again.
    pathname = '/product/[id]'
    params = { id: 'abc-123' }
    render(inLanguage(<LanguageToggle />, 'pt'))
    await userEvent.click(button('English'))

    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/product/[id]', params: { id: 'abc-123' } }),
      { locale: 'en' },
    )
  })

  it('ignores a press on the language already showing', async () => {
    // A navigation there would be a round trip that changes nothing.
    render(inLanguage(<LanguageToggle />, 'pt'))
    await userEvent.click(button('Português'))

    expect(replace).not.toHaveBeenCalled()
  })

  it('is labelled in the language it is showing', () => {
    render(inLanguage(<LanguageToggle />, 'en'))

    expect(screen.getByRole('group')).toHaveAccessibleName('Language')
  })
})
