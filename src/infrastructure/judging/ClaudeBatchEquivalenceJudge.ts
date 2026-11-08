import type {
  EquivalenceQuestion,
  EquivalenceVerdict,
  ProductEquivalenceJudge,
} from '@/application/ports/ProductEquivalenceJudge'
import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import {
  CACHED_SYSTEM,
  type ClaudeJudgeConfig,
  asked,
  readVerdicts,
} from './ClaudeEquivalenceJudge'

const BATCHES = 'https://api.anthropic.com/v1/messages/batches'
const VERSION = '2023-06-01'
const TIMEOUT_MS = 120_000

/** Pairs per request inside the batch, matching the synchronous judge. */
const PER_REQUEST = 25

/**
 * Anthropic gives a batch 24 hours; past that its requests expire unasked.
 * Stopping a little before is what turns "it expired" into "collect what
 * finished and resubmit the rest".
 */
const DEADLINE_MS = 23 * 60 * 60 * 1000

/** Long enough not to hammer the endpoint, short enough to feel live. */
const POLL_MS = 20_000

/**
 * Asks the same questions, asynchronously, for half the price.
 *
 * The synchronous judge sends one request per 25 pairs and waits for each
 * answer. For the backlog that is 1,618 requests in series — hours of one
 * process, where a request that fails takes its 25 pairs with it. The
 * Message Batches API takes all of them at once, runs them whenever there
 * is capacity, and charges 50% for the privilege. Nothing is waiting on
 * this, so the latency is free to spend.
 *
 * Same port as the synchronous judge, so the caller swaps one for the
 * other and nothing else moves. The difference is that this one wants
 * every question in a single call rather than 25 at a time — see
 * `submit`'s own batching — and that it can take an hour to answer.
 *
 * Complexity: one submission, one poll per 20s, one streamed read.
 */
export class ClaudeBatchEquivalenceJudge implements ProductEquivalenceJudge {
  readonly name: string

  constructor(
    private readonly config: ClaudeJudgeConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.name = config.model ?? 'claude-haiku-4-5-20251001'
  }

  async judge(questions: readonly EquivalenceQuestion[]): Promise<readonly EquivalenceVerdict[]> {
    if (questions.length === 0) return []

    const id = await this.submit(questions)
    if (!id) return []

    this.logger.info('judge.batch_submitted', { id, questions: questions.length })
    console.log(`  lote ${id} enviado — ${questions.length} pares`)

    const finished = await this.awaitEnd(id)
    if (!finished) return []

    const verdicts = await this.collect(id)

    // Same promise the synchronous judge makes: a pair nobody answered
    // stays unanswered rather than being filled in on its behalf.
    const askedIds = new Set(questions.map((question) => question.id))
    return verdicts.filter((verdict) => askedIds.has(verdict.id))
  }

  /** Returns the batch id, or null when the API would not take it. */
  private async submit(questions: readonly EquivalenceQuestion[]): Promise<string | null> {
    const requests = []
    for (let index = 0; index < questions.length; index += PER_REQUEST) {
      const slice = questions.slice(index, index + PER_REQUEST)
      requests.push({
        // The index, not a pair id: one request carries 25 pairs, and the
        // custom_id has to name the request rather than any one of them.
        custom_id: `pairs-${index}`,
        params: {
          model: this.name,
          max_tokens: this.config.maxTokens ?? 8_000,
          system: CACHED_SYSTEM,
          messages: [{ role: 'user', content: JSON.stringify({ pairs: slice.map(asked) }) }],
        },
      })
    }

    const response = await this.http.postJson(
      BATCHES,
      { requests },
      { timeoutMs: TIMEOUT_MS, headers: this.headers() },
    )

    if (response.status !== 'ok') {
      this.logger.error('judge.batch_refused', {
        result: response.status,
        reason: 'body' in response ? (response.body ?? null) : null,
        requests: requests.length,
      })
      return null
    }

    const id = (response.body as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }

  /** Polls until the batch stops processing, or the deadline passes. */
  private async awaitEnd(id: string): Promise<boolean> {
    const until = this.now() + DEADLINE_MS

    for (;;) {
      const response = await this.http.getJson(`${BATCHES}/${id}`, {
        timeoutMs: TIMEOUT_MS,
        headers: this.headers(),
      })

      if (response.status !== 'ok') {
        // A poll that fails is not a batch that failed. Keep waiting: the
        // work is already paid for and running on somebody else's machine.
        this.logger.warn('judge.batch_poll_failed', { id, result: response.status })
      } else {
        const body = response.body as {
          processing_status?: string
          request_counts?: Record<string, number>
        }
        const counts = body.request_counts ?? {}
        const done = (counts.succeeded ?? 0) + (counts.errored ?? 0) + (counts.canceled ?? 0)

        if (body.processing_status === 'ended') {
          console.log(`  lote terminado — ${done} pedidos, ${counts.errored ?? 0} com erro`)
          return true
        }

        console.log(
          `  ${body.processing_status ?? '?'}  ${done} prontos, ${counts.processing ?? 0} na fila`,
        )
      }

      if (this.now() >= until) {
        this.logger.error('judge.batch_deadline', { id })
        console.error(`  lote ${id} ainda não terminou. Retome com --collect ${id}`)
        return false
      }

      await this.sleep(POLL_MS)
    }
  }

  /**
   * Reads the results, which arrive as JSONL rather than as a document —
   * one object per line, each naming the request it answers.
   */
  async collect(id: string): Promise<EquivalenceVerdict[]> {
    const response = await this.http.getText(`${BATCHES}/${id}/results`, {
      timeoutMs: TIMEOUT_MS,
      headers: this.headers(),
    })

    if (response.status !== 'ok') {
      this.logger.error('judge.batch_unreadable', { id, result: response.status })
      return []
    }

    const verdicts: EquivalenceVerdict[] = []
    let failed = 0

    for (const line of response.body.split('\n')) {
      if (line.trim() === '') continue

      let parsed: { custom_id?: unknown; result?: { type?: unknown; message?: unknown } }
      try {
        parsed = JSON.parse(line)
      } catch {
        failed += 1
        continue
      }

      // succeeded is the only type carrying a message; errored, canceled
      // and expired leave their pairs pending, which a rerun picks up.
      if (parsed.result?.type !== 'succeeded') {
        failed += 1
        continue
      }

      const read = readVerdicts(parsed.result.message)
      if (read === null) {
        failed += 1
        continue
      }
      verdicts.push(...read)
    }

    if (failed > 0) this.logger.warn('judge.batch_partial', { id, failed })
    return verdicts
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey,
      'anthropic-version': VERSION,
      'content-type': 'application/json',
      ...(this.config.workspaceId ? { 'anthropic-workspace-id': this.config.workspaceId } : {}),
    }
  }
}
