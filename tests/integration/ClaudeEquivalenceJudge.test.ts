import { describe, expect, it } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import type { EquivalenceQuestion } from '@/application/ports/ProductEquivalenceJudge'
import { ClaudeEquivalenceJudge } from '@/infrastructure/judging/ClaudeEquivalenceJudge'

const QUESTIONS: EquivalenceQuestion[] = [
  {
    id: 'p1',
    left: {
      name: 'Sabonete Barra Vegetal Odor de Rosas Phebo Envoltório 90g',
      brand: 'Phebo',
      size: '90 g',
    },
    right: {
      name: 'Sabonete Barra Odor de Rosas Phebo Envoltório - 90g',
      brand: null,
      size: '90 g',
    },
  },
  {
    id: 'p2',
    left: { name: 'Saco de Lixo Ecolix 50 Litros Pacote C/10', brand: null, size: '10 un' },
    right: { name: 'Saco de Lixo Ecolix 100 Litros Pacote C/5', brand: null, size: '10 un' },
  },
]

function replying(text: string) {
  const sent: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []

  const http = {
    async getJson() {
      throw new Error('not used')
    },
    async postJson(url: string, body: unknown, options?: { headers?: Record<string, string> }) {
      sent.push({ url, body, headers: options?.headers ?? {} })
      return {
        status: 'ok' as const,
        statusCode: 200,
        body: { content: [{ type: 'text', text }] },
        headers: {},
      }
    },
  }

  const judge = new ClaudeEquivalenceJudge({ apiKey: 'sk-test' }, http, new RecordingLogger())
  return { judge, sent }
}

const ANSWER = JSON.stringify({
  verdicts: [
    { id: 'p1', same: true, reason: 'mesmo sabonete, uma loja escreve mais' },
    { id: 'p2', same: false, reason: 'embalagens diferentes: 50L com 10 e 100L com 5' },
  ],
})

describe('ClaudeEquivalenceJudge', () => {
  it('returns a verdict per pair, keyed back to the pair asked about', async () => {
    const { judge } = replying(ANSWER)

    const verdicts = await judge.judge(QUESTIONS)

    expect(verdicts).toEqual([
      { id: 'p1', same: true, reason: 'mesmo sabonete, uma loja escreve mais' },
      { id: 'p2', same: false, reason: 'embalagens diferentes: 50L com 10 e 100L com 5' },
    ])
  })

  it('reads JSON out of a reply that wraps it in prose', async () => {
    // Models narrate. The verdicts are still in there.
    const { judge } = replying(`Claro! Aqui estão:\n\n${ANSWER}\n\nEspero ter ajudado.`)

    expect(await judge.judge(QUESTIONS)).toHaveLength(2)
  })

  it('leaves a pair undecided rather than answering for the model', async () => {
    // A missing verdict means ask again another day. Filling it in would
    // be guessing with the authority of a judgement.
    const { judge } = replying(
      JSON.stringify({ verdicts: [{ id: 'p1', same: true, reason: 'ok' }] }),
    )

    const verdicts = await judge.judge(QUESTIONS)

    expect(verdicts.map((verdict) => verdict.id)).toEqual(['p1'])
  })

  it('ignores a verdict for a pair it never asked about', async () => {
    const { judge } = replying(
      JSON.stringify({ verdicts: [{ id: 'invented', same: true, reason: 'x' }] }),
    )

    expect(await judge.judge(QUESTIONS)).toEqual([])
  })

  it('decides nothing when the reply cannot be read', async () => {
    const { judge } = replying('desculpe, não consegui')

    expect(await judge.judge(QUESTIONS)).toEqual([])
  })

  it('decides nothing when the API refuses', async () => {
    const http = {
      async getJson() {
        throw new Error('not used')
      },
      async postJson() {
        return { status: 'http-error' as const, statusCode: 429 }
      },
    }
    const judge = new ClaudeEquivalenceJudge({ apiKey: 'sk-test' }, http, new RecordingLogger())

    expect(await judge.judge(QUESTIONS)).toEqual([])
  })

  it('sends the key and the API version, and no prices', async () => {
    // What a product costs has no bearing on whether it is the same
    // product, and sending it would put our price data somewhere it does
    // not need to be.
    const { judge, sent } = replying(ANSWER)
    await judge.judge(QUESTIONS)

    expect(sent[0].headers['x-api-key']).toBe('sk-test')
    expect(sent[0].headers['anthropic-version']).toBe('2023-06-01')

    // The pairs themselves: names, brands and sizes, and nothing else.
    const asked = (sent[0].body as { messages: Array<{ content: string }> }).messages[0].content
    const pairs = JSON.parse(asked) as { pairs: Array<Record<string, unknown>> }

    expect(Object.keys(pairs.pairs[0]).sort()).toEqual(['a', 'b', 'id'])
    expect(asked).not.toMatch(/R\$|price_cents|priceReais/)
  })

  it('asks nothing when there is nothing to ask', async () => {
    const { judge, sent } = replying(ANSWER)

    expect(await judge.judge([])).toEqual([])
    expect(sent).toHaveLength(0)
  })
})
