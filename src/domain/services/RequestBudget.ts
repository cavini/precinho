/**
 * How many requests a store has agreed to receive from us in a day.
 *
 * Tauste granted access on condition of twenty requests a day, set by their
 * technical coordinator to keep their system stable. A condition somebody
 * attached to a permission is a condition the code has to keep — not one the
 * collector merely intends to keep. Earlier today I managed to run three
 * collectors at once without noticing, which is exactly why an intention is
 * not good enough here.
 *
 * Counts the whole day rather than the run, so a second run on the same day
 * does not get a fresh allowance.
 */
export class RequestBudget {
  private runSpent = 0

  private constructor(
    /** Null means no agreed limit. */
    private readonly limit: number | null,
    private readonly alreadySpentToday: number,
  ) {}

  /**
   * A budget of `limit` requests for the day, `spentToday` of them gone.
   *
   * A negative or unreadable limit becomes zero rather than unlimited:
   * getting that backwards would turn a typo in a store row into an
   * unbounded crawl against somebody who asked us to go easy.
   */
  static of(limit: number, spentToday = 0): RequestBudget {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
    const safeSpent = Number.isFinite(spentToday) && spentToday > 0 ? Math.floor(spentToday) : 0

    return new RequestBudget(safeLimit, safeSpent)
  }

  /** For a store that has set no limit. */
  static unlimited(): RequestBudget {
    return new RequestBudget(null, 0)
  }

  /**
   * Charges one request, or refuses.
   *
   * A refusal costs nothing, so an exhausted budget cannot be driven
   * further negative by callers that keep trying.
   *
   * Complexity: O(1).
   */
  tryConsume(): boolean {
    if (this.exhausted) return false

    this.runSpent += 1
    return true
  }

  /** Everything spent today, including before this run started. */
  get spent(): number {
    return this.alreadySpentToday + this.runSpent
  }

  /** Just this run, for the run report. */
  get spentThisRun(): number {
    return this.runSpent
  }

  get remaining(): number {
    if (this.limit === null) return Number.POSITIVE_INFINITY
    return Math.max(0, this.limit - this.spent)
  }

  get exhausted(): boolean {
    return this.remaining <= 0
  }
}
