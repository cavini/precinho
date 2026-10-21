import type {
  EquivalenceQuestion,
  EquivalenceVerdict,
  ProductEquivalenceJudge,
} from '@/application/ports/ProductEquivalenceJudge'
import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'

const API = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
const TIMEOUT_MS = 120_000

/**
 * The instruction the whole thing turns on.
 *
 * Written against the pairs the heuristic actually got wrong, because a
 * general "are these the same?" invites the same shallow reading that a
 * similarity coefficient gives: Bolo de Brigadeiro and Bolo de Brigadeiro
 * com Amêndoas share every word but one, and that word is the product.
 *
 * It is told to refuse when unsure. An undecided pair costs a duplicate
 * row, which somebody will notice; a wrong merge quotes a price for a
 * product the shopper is not looking at, which nobody will.
 */
const INSTRUCTION = `You are matching grocery products across Brazilian supermarket chains for a price comparison site.

Each chain writes the same product differently. "Sabonete Barra Vegetal Odor de Rosas Phebo Envoltório 90g" and "Sabonete Barra Odor de Rosas Phebo Envoltório - 90g" are the same soap: one shop is wordier.

But a single word often carries the entire difference, and then they are NOT the same product:
- "Bolo de Brigadeiro" vs "Bolo de Brigadeiro com Amêndoas" — different cake
- "Cepacol Menta Fusion" vs "Cepacol 3 em 1 Menta Fusion" — different formulation
- "Nivea Roll-On Uniformiza" vs "Nivea Roll-On Derma Control Uniformiza" — different line
- "Saco de Lixo Ecolix 50 Litros C/10" vs "Ecolix 100 Litros C/5" — different pack entirely
- "Linguado Frumar" vs "Linguado Frescatto" — different brand
- Any flavour, variant, concentration or pack-count difference

Words that do NOT change the product: marketing noise ("Oferta", "Promoção"), the chain's own phrasing, word order, punctuation, abbreviations ("Lay's"/"Lays"), and redundant descriptors that merely restate what the item is.

Answer only for the pairs given. If you are not sure, answer false — a missed match costs a duplicate row, a wrong match quotes somebody the price of a product they are not looking at.

Reply with JSON only: {"verdicts":[{"id":"<id>","same":true|false,"reason":"<under 15 words, Portuguese>"}]}`

export type ClaudeJudgeConfig = {
  apiKey: string
  /**
   * Required when the key belongs to an organisation rather than to one
   * workspace: such a key cannot pick a workspace on its own, and the API
   * answers 400 saying so rather than guessing.
   */
  workspaceId?: string
  /** Haiku is enough: the question is short and the answer is a boolean. */
  model?: string
  maxTokens?: number
}

/**
 * Asks Claude whether two product names are the same product.
 *
 * Complexity: one request per batch, O(n) over the questions in it.
 */
export class ClaudeEquivalenceJudge implements ProductEquivalenceJudge {
  readonly name: string

  constructor(
    private readonly config: ClaudeJudgeConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {
    this.name = config.model ?? 'claude-haiku-4-5-20251001'
  }

  async judge(questions: readonly EquivalenceQuestion[]): Promise<readonly EquivalenceVerdict[]> {
    if (questions.length === 0) return []

    const response = await this.http.postJson(
      API,
      {
        model: this.name,
        max_tokens: this.config.maxTokens ?? 8_000,
        system: INSTRUCTION,
        messages: [{ role: 'user', content: JSON.stringify({ pairs: questions.map(asked) }) }],
      },
      {
        timeoutMs: TIMEOUT_MS,
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': VERSION,
          'content-type': 'application/json',
          ...(this.config.workspaceId ? { 'anthropic-workspace-id': this.config.workspaceId } : {}),
        },
      },
    )

    if (response.status !== 'ok') {
      this.logger.warn('judge.request_failed', {
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
        // The API says why — that the key has no workspace, that the
        // balance is empty — and reading it out of the log beats
        // reproducing the request by hand to find out.
        reason: 'body' in response ? (response.body ?? null) : null,
        asked: questions.length,
      })
      return []
    }

    const verdicts = readVerdicts(response.body)
    if (verdicts === null) {
      this.logger.warn('judge.unreadable_reply', { asked: questions.length })
      return []
    }

    // Anything the model did not answer stays undecided rather than being
    // filled in on its behalf.
    const asked_ids = new Set(questions.map((question) => question.id))
    return verdicts.filter((verdict) => asked_ids.has(verdict.id))
  }
}

/** Only the fields that bear on identity; ids stay, prices never go. */
function asked(question: EquivalenceQuestion) {
  return {
    id: question.id,
    a: [question.left.name, question.left.brand, question.left.size].filter(Boolean).join(' | '),
    b: [question.right.name, question.right.brand, question.right.size].filter(Boolean).join(' | '),
  }
}

/**
 * Pulls the verdicts out of a reply, tolerating the prose a model
 * sometimes wraps JSON in.
 */
function readVerdicts(body: unknown): EquivalenceVerdict[] | null {
  const text = firstText(body)
  if (text === null) return null

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }

  const list = (parsed as { verdicts?: unknown }).verdicts
  if (!Array.isArray(list)) return null

  const verdicts: EquivalenceVerdict[] = []
  for (const row of list) {
    if (typeof row !== 'object' || row === null) continue
    const { id, same, reason } = row as Record<string, unknown>
    if (typeof id !== 'string' || typeof same !== 'boolean') continue

    verdicts.push({ id, same, reason: typeof reason === 'string' ? reason.slice(0, 200) : '' })
  }

  return verdicts
}

function firstText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null

  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return null

  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }

  return null
}
