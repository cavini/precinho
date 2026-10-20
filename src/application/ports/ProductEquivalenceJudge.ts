/** Two catalogue rows that might be the same product. */
export type EquivalenceQuestion = {
  /** Stable id for the pair, so an answer can be filed against it. */
  id: string
  left: { name: string; brand: string | null; size: string | null }
  right: { name: string; brand: string | null; size: string | null }
}

export type EquivalenceVerdict = {
  id: string
  same: boolean
  /** In the judge's words, so a wrong merge can be audited afterwards. */
  reason: string
}

/**
 * Decides whether two product rows name the same thing.
 *
 * A port because the judgement is the expensive, fallible part and the
 * rest of the pipeline should not care how it is made. Today it is a
 * language model; it could be a person working through a queue, or a
 * table of hand-written rules for a category that matters enough.
 *
 * It is asked only about pairs a cheap heuristic has already shortlisted.
 * The catalogue holds ninety thousand products — four billion pairs — and
 * the shortlist is about twelve thousand, so what reaches here is the
 * small set where the answer is genuinely unclear.
 */
export interface ProductEquivalenceJudge {
  /** Named for the verdict record, so an answer can be traced to its author. */
  readonly name: string

  /**
   * Answers a batch. May return fewer verdicts than questions: anything
   * missing is treated as undecided and asked again another day, which is
   * safer than guessing on its behalf.
   */
  judge(questions: readonly EquivalenceQuestion[]): Promise<readonly EquivalenceVerdict[]>
}
