// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SearchResultItem } from '@/application/use-cases/SearchProducts'
import { ResultList } from './ResultList'

function anItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    productId: 'p1',
    name: 'Arroz Branco Prato Fino Tipo 1 5kg',
    description: null,
    brand: 'Prato Fino',
    size: '5 kg',
    imageUrl: null,
    cheapest: {
      storeId: 's1',
      storeName: "Sam's Club",
      priceCents: 2780,
      priceLabel: 'R$ 27,80',
      unitPriceLabel: 'R$ 5,56/kg',
      url: 'https://example.test/samsclub/arroz',
    },
    offers: [
      {
        storeId: 's1',
        storeName: "Sam's Club",
        priceLabel: 'R$ 27,80',
        url: 'https://example.test/samsclub/arroz',
        isCheapest: true,
      },
      {
        storeId: 's2',
        storeName: 'Atacadão',
        priceLabel: 'R$ 29,19',
        url: 'https://example.test/atacadao/arroz',
        isCheapest: false,
      },
    ],
    availableStoreCount: 2,
    spread: { amountLabel: 'R$ 1,39', percent: 5 },
    ...overrides,
  }
}

describe('ResultList', () => {
  it('shows every store that has the product, not just the cheapest', () => {
    // The listing used to show one price, which compares nothing.
    render(<ResultList query="arroz" items={[anItem()]} />)

    expect(screen.getByText("Sam's Club")).toBeInTheDocument()
    expect(screen.getByText('Atacadão')).toBeInTheDocument()
    expect(screen.getByText('R$ 29,19')).toBeInTheDocument()
  })

  it('names the store even when only one sells it', () => {
    // Gating the list on "more than one offer" left these rows showing a
    // price with nothing saying where it came from.
    const single = anItem({
      offers: [
        {
          storeId: 's1',
          storeName: 'Pão de Açúcar',
          priceLabel: 'R$ 4,29',
          url: 'https://example.test/pa/sabonete',
          isCheapest: true,
        },
      ],
      availableStoreCount: 1,
      spread: null,
    })

    render(<ResultList query="sabonete" items={[single]} />)

    expect(screen.getByText('Pão de Açúcar')).toBeInTheDocument()
  })

  it('never nests a store link inside the product link', () => {
    // An <a> inside an <a> is invalid HTML, and invalid nesting is one of
    // the things React reports as a hydration mismatch.
    const { container } = render(<ResultList query="arroz" items={[anItem()]} />)

    for (const anchor of container.querySelectorAll('a')) {
      expect(within(anchor).queryAllByRole('link')).toHaveLength(0)
    }
  })

  it('sends a shopper to the shop, not to our own page, from a price', () => {
    render(<ResultList query="arroz" items={[anItem()]} />)

    const store = screen.getByRole('link', { name: 'Atacadão' })
    expect(store).toHaveAttribute('href', 'https://example.test/atacadao/arroz')
    expect(store).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('says so plainly when no marked shop has it', () => {
    const none = anItem({ cheapest: null, offers: [], availableStoreCount: 0, spread: null })
    render(<ResultList query="arroz" items={[none]} />)

    expect(screen.getByText(/sem estoque nos mercados marcados/i)).toBeInTheDocument()
  })

  it('explains an empty result instead of showing a blank page', () => {
    render(<ResultList query="xyzabc" items={[]} />)

    expect(screen.getByText(/não achei nada/i)).toBeInTheDocument()
    expect(screen.getByText('xyzabc')).toBeInTheDocument()
  })
})
