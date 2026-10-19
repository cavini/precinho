import { describe, expect, it } from 'vitest'
import { SearchQuery } from './SearchQuery'

describe('SearchQuery', () => {
  it('normalises what the shopper typed', () => {
    const q = SearchQuery.tryParse('  Açúcar   UNIÃO  ')
    expect(q?.normalized).toBe('acucar uniao')
    expect(q?.tokens).toEqual(['acucar', 'uniao'])
  })

  it('keeps the original text for echoing back in the field', () => {
    expect(SearchQuery.tryParse('Açúcar União')?.raw).toBe('Açúcar União')
  })

  it('keeps sizes searchable', () => {
    expect(SearchQuery.tryParse('coca 2L')?.tokens).toEqual(['coca', '2l'])
  })

  it('needs at least two characters to be worth a query', () => {
    expect(SearchQuery.tryParse('a')).toBeNull()
    expect(SearchQuery.tryParse(' ')).toBeNull()
    expect(SearchQuery.tryParse('')).toBeNull()
  })

  describe('bounding the cost of a query', () => {
    it('refuses text longer than the limit instead of truncating it', () => {
      // Truncating would quietly search for something the shopper did not ask for.
      expect(SearchQuery.tryParse('a'.repeat(SearchQuery.MAX_LENGTH + 1))).toBeNull()
      expect(SearchQuery.tryParse('a'.repeat(SearchQuery.MAX_LENGTH))).not.toBeNull()
    })

    it('caps how many tokens reach the database', () => {
      // Every token becomes a predicate, so an unbounded count is a cheap way
      // to make a single request expensive.
      // Twenty tokens that still fit inside MAX_LENGTH, so this exercises
      // the token cap rather than the length guard.
      const many = Array.from({ length: 20 }, (_, i) =>
        `a${String.fromCharCode(98 + i)}`,
      ).join(' ')
      expect(many.length).toBeLessThanOrEqual(SearchQuery.MAX_LENGTH)
      expect(SearchQuery.tryParse(many)!.tokens).toHaveLength(SearchQuery.MAX_TOKENS)
    })

    it('drops stopwords and single letters, which match everything', () => {
      expect(SearchQuery.tryParse('leite de a coca')!.tokens).toEqual(['leite', 'coca'])
    })

    it('rejects a query that is nothing but stopwords', () => {
      expect(SearchQuery.tryParse('de')).toBeNull()
      expect(SearchQuery.tryParse('de da do')).toBeNull()
    })
  })

  describe('hostile input', () => {
    it('strips control characters and zero-width padding', () => {
      // Written as escapes on purpose: a literal zero-width space in the
      // source is invisible to the next reader and editors strip it.
      const padded = 'leite \u200b\u0007 integral'
      expect(SearchQuery.tryParse(padded)?.tokens).toEqual(['leite', 'integral'])
    })

    it('tokenises to alphanumerics only, so no syntax survives', () => {
      const q = SearchQuery.tryParse("100% leite'; drop table offers;--")!
      expect(q.tokens.every((t) => /^[a-z0-9]+$/.test(t))).toBe(true)
    })

    it('rejects a query made only of punctuation', () => {
      expect(SearchQuery.tryParse('--;%')).toBeNull()
      expect(SearchQuery.tryParse('%%%%')).toBeNull()
    })
  })

  describe('likePattern — ILIKE wildcards must stay literal', () => {
    it('wraps the term and escapes the wildcards', () => {
      expect(SearchQuery.likePattern('leite')).toBe('%leite%')
      expect(SearchQuery.likePattern('50%')).toBe(String.raw`%50\%%`)
      expect(SearchQuery.likePattern('a_b')).toBe(String.raw`%a\_b%`)
    })

    it('escapes the escape character itself', () => {
      expect(SearchQuery.likePattern('a\\b')).toBe(String.raw`%a\\b%`)
    })
  })
})
