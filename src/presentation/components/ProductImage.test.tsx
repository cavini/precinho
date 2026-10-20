// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProductImage } from './ProductImage'

describe('ProductImage', () => {
  it('shows the photo when there is one', () => {
    render(<ProductImage src="https://cdn.example.test/arroz.png" className="h-20 w-20" />)

    expect(screen.getByRole('presentation')).toHaveAttribute(
      'src',
      'https://cdn.example.test/arroz.png',
    )
  })

  it('draws a placeholder when the catalogue published no photo', () => {
    const { container } = render(<ProductImage src={null} className="h-20 w-20" />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to the placeholder when the photo fails to load', () => {
    // A chain reorganises its CDN and every link stored that morning goes
    // stale. The browser renders its broken-image glyph, which reads as a
    // broken app rather than a missing picture.
    const { container } = render(
      <ProductImage src="https://cdn.example.test/gone.png" className="h-20 w-20" />,
    )

    fireEvent.error(screen.getByRole('presentation'))

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('keeps the size the caller asked for in both states', () => {
    // The feed wants a tall card and search a thumbnail; a placeholder of
    // the wrong size makes the row jump when a photo is missing.
    const { container: withPhoto } = render(
      <ProductImage src="https://cdn.example.test/a.png" className="h-36 w-full" />,
    )
    const { container: without } = render(<ProductImage src={null} className="h-36 w-full" />)

    expect(withPhoto.querySelector('img')?.className).toContain('h-36 w-full')
    expect(without.firstElementChild?.className).toContain('h-36 w-full')
  })

  it('hides the placeholder from screen readers', () => {
    // The photo carries nothing the name does not, so announcing "image
    // placeholder" on every row is noise.
    const { container } = render(<ProductImage src={null} className="h-20 w-20" />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
