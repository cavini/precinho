import { describe, expect, it } from 'vitest'
import { Quantity } from '../value-objects/Quantity'
import { ProductNameParser } from './ProductNameParser'

const parser = new ProductNameParser()

describe('ProductNameParser', () => {
  describe('sizes as the live catalogues actually write them', () => {
    const cases: Array<[string, Quantity]> = [
      ['Arroz Nikkoh 5kg', Quantity.of(5, 'kg')],
      ['Creme de Leite Italac 200g', Quantity.of(0.2, 'kg')],
      ['Leite de Coco Sococo 200ml', Quantity.of(0.2, 'L')],
      ['Refrigerante Original Coca-Cola Garrafa 2L', Quantity.of(2, 'L')],
      ['Leite Condensado Piracanjuba 395g', Quantity.of(0.395, 'kg')],
      ['Refrigerante Coca-Cola Lata 350ml', Quantity.of(0.35, 'L')],
    ]

    it.each(cases)('reads %s', (name, expected) => {
      expect(parser.extractSize(name)).toEqual(expected)
    })
  })

  it('accepts a decimal comma, which is how sizes are written here', () => {
    expect(parser.extractSize('Sabao em Po Omo 1,6kg')).toEqual(Quantity.of(1.6, 'kg'))
  })

  it('accepts the unit spelled out and separated by a space', () => {
    expect(parser.extractSize('Leite Longa Vida Italac 1 Litro')).toEqual(Quantity.of(1, 'L'))
    expect(parser.extractSize('Cafe Pilao 500 g')).toEqual(Quantity.of(0.5, 'kg'))
  })

  it('ignores casing', () => {
    expect(parser.extractSize('Azeite Gallo 500ML')).toEqual(Quantity.of(0.5, 'L'))
  })

  it('multiplies a multipack out to its total', () => {
    expect(parser.extractSize('Cerveja Heineken 6x350ml')).toEqual(Quantity.of(2.1, 'L'))
    expect(parser.extractSize('Agua Mineral 12 x 500ml')).toEqual(Quantity.of(6, 'L'))
  })

  it('prefers the multipack total over the single size inside it', () => {
    // "6x350ml" contains "350ml"; the pack is what the shopper pays for.
    expect(parser.extractSize('Cerveja 6x350ml')?.amount).toBe(2.1)
  })

  describe('packs written in words rather than with an x', () => {
    it('multiplies "Pack 6 ... 1,27l Cada", which wholesale clubs use', () => {
      // Found in production: Sam's Club sells this six-pack while everyone
      // else sells the single bottle. Reading it as 1,27L made the feed
      // compare a pack against a unit and headline a 29 reais saving that
      // did not exist.
      expect(parser.extractSize('Água Mineral com Gás Pack 6 Galões 1,27l Cada')).toEqual(
        Quantity.of(7.62, 'L'),
      )
    })

    it('multiplies a case count', () => {
      expect(parser.extractSize('Refrigerante Caixa 12 Latas 350ml')).toEqual(
        Quantity.of(4.2, 'L'),
      )
      expect(parser.extractSize('Cerveja Fardo 12 Unidades 269ml')).toEqual(
        Quantity.of(3.228, 'L'),
      )
    })

    it('does not read a size as a count', () => {
      // "Caixa 1000g" is a one-kilo box, not a thousand of something.
      expect(parser.extractSize('Arroz Paganini Caixa 1000g')).toEqual(Quantity.of(1, 'kg'))
      expect(parser.extractSize('Leite Caixa 1L')).toEqual(Quantity.of(1, 'L'))
    })

    it('ignores an implausible count', () => {
      expect(parser.extractSize('Promo Pack 500 Arroz 1kg')).toEqual(Quantity.of(1, 'kg'))
    })

    it('still prefers an explicit 6x350ml over a word pack', () => {
      expect(parser.extractSize('Cerveja Pack 6x350ml')).toEqual(Quantity.of(2.1, 'L'))
    })
  })

  it('counts a dozen as twelve', () => {
    expect(parser.extractSize('Ovo Branco Grande 1 duzia')).toEqual(Quantity.of(12, 'un'))
  })

  it('takes the last size in the name, not the first number', () => {
    // Grading and type numbers come before the size.
    expect(parser.extractSize('Arroz Tio Joao Tipo 1 5kg')).toEqual(Quantity.of(5, 'kg'))
    expect(parser.extractSize('Shampoo 2 em 1 400ml')).toEqual(Quantity.of(0.4, 'L'))
  })

  it('does not mistake the start of a word for a unit', () => {
    // The "L" of "Lata" is not litres, but the "Litro" of "1 Litro" is.
    expect(parser.extractSize('Arroz Tipo 1 Lata')).toBeNull()
    expect(parser.extractSize('Molho Tipo 1 Litro Caseiro')).toEqual(Quantity.of(1, 'L'))
    expect(parser.extractSize('Leite 1 Leve Mais')).toBeNull()
  })

  it('returns null when the name carries no size', () => {
    expect(parser.extractSize('Banana Prata')).toBeNull()
    expect(parser.extractSize('')).toBeNull()
  })

  it('ignores a size of zero rather than reporting it', () => {
    expect(parser.extractSize('Promocao 0kg')).toBeNull()
  })

  describe('searchText', () => {
    it('joins name and brand for the index', () => {
      expect(parser.buildSearchText('Arroz Nikkoh 5kg', 'TIO JOAO')).toBe(
        'arroz nikkoh 5kg tio joao',
      )
    })

    it('does not repeat a brand already in the name', () => {
      expect(parser.buildSearchText('Arroz Tio Joao 5kg', 'Tio Joao')).toBe('arroz tio joao 5kg')
    })

    it('copes with a missing brand', () => {
      expect(parser.buildSearchText('Banana Prata', null)).toBe('banana prata')
    })
  })

  describe('brand casing', () => {
    it('calms a brand the catalogue shouts', () => {
      expect(parser.normalizeBrand('TIO JOAO')).toBe('Tio Joao')
      expect(parser.normalizeBrand('coca-cola')).toBe('Coca-Cola')
    })

    it('leaves a digit-bearing word alone inside a shouted brand', () => {
      expect(parser.normalizeBrand('CLUB SOCIAL 144G')).toBe('Club Social 144G')
    })

    it('leaves a short acronym alone', () => {
      expect(parser.normalizeBrand('3M')).toBe('3M')
      expect(parser.normalizeBrand('TNT')).toBe('TNT')
    })

    it('returns null for an empty brand instead of an empty string', () => {
      expect(parser.normalizeBrand('')).toBeNull()
      expect(parser.normalizeBrand('   ')).toBeNull()
    })
  })
})
