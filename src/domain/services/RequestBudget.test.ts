import { describe, expect, it } from 'vitest'
import { RequestBudget } from './RequestBudget'

describe('RequestBudget', () => {
  describe('a store that set us a limit', () => {
    it('allows requests up to it', () => {
      const budget = RequestBudget.of(3)

      expect(budget.tryConsume()).toBe(true)
      expect(budget.tryConsume()).toBe(true)
      expect(budget.tryConsume()).toBe(true)
    })

    it('refuses the one past it', () => {
      // Tauste granted access on condition of 20 requests a day. A limit
      // somebody agreed to is a limit the code has to keep, not one the
      // collector intends to.
      const budget = RequestBudget.of(2)
      budget.tryConsume()
      budget.tryConsume()

      expect(budget.tryConsume()).toBe(false)
    })

    it('does not spend anything on a refused request', () => {
      const budget = RequestBudget.of(1)
      budget.tryConsume()
      budget.tryConsume()
      budget.tryConsume()

      expect(budget.spent).toBe(1)
    })

    it('reports what is left', () => {
      const budget = RequestBudget.of(5)
      budget.tryConsume()
      budget.tryConsume()

      expect(budget.remaining).toBe(3)
      expect(budget.exhausted).toBe(false)
    })

    it('knows when it is done', () => {
      const budget = RequestBudget.of(1)
      budget.tryConsume()

      expect(budget.remaining).toBe(0)
      expect(budget.exhausted).toBe(true)
    })
  })

  describe('carrying yesterday forward', () => {
    it('starts from what was already spent today', () => {
      // A second run on the same day must not get a fresh allowance.
      const budget = RequestBudget.of(20, 18)

      expect(budget.tryConsume()).toBe(true)
      expect(budget.tryConsume()).toBe(true)
      expect(budget.tryConsume()).toBe(false)
    })

    it('is already exhausted when the day is used up', () => {
      const budget = RequestBudget.of(20, 20)

      expect(budget.exhausted).toBe(true)
      expect(budget.tryConsume()).toBe(false)
    })

    it('counts the whole day, not just this run', () => {
      const budget = RequestBudget.of(20, 5)
      budget.tryConsume()

      expect(budget.spent).toBe(6)
      expect(budget.spentThisRun).toBe(1)
    })

    it('ignores a stored count that makes no sense', () => {
      for (const nonsense of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(RequestBudget.of(3, nonsense).remaining).toBe(3)
      }
    })
  })

  describe('a store with no limit', () => {
    it('never refuses', () => {
      const budget = RequestBudget.unlimited()

      for (let i = 0; i < 1000; i += 1) expect(budget.tryConsume()).toBe(true)
      expect(budget.exhausted).toBe(false)
    })

    it('still counts, so a run can be reported', () => {
      const budget = RequestBudget.unlimited()
      budget.tryConsume()
      budget.tryConsume()

      expect(budget.spent).toBe(2)
      expect(budget.remaining).toBe(Number.POSITIVE_INFINITY)
    })
  })

  describe('a limit that is not a limit', () => {
    it('refuses everything at zero', () => {
      expect(RequestBudget.of(0).tryConsume()).toBe(false)
    })

    it('treats a negative limit as zero rather than as unlimited', () => {
      // Getting this backwards would turn a typo into an unbounded crawl.
      expect(RequestBudget.of(-1).tryConsume()).toBe(false)
    })
  })
})
