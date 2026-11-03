import { describe, expect, it } from 'vitest'
import type { HttpClient, HttpJsonResponse, HttpTextResponse } from '@/application/ports/HttpClient'
import type { EquivalenceQuestion } from '@/application/ports/ProductEquivalenceJudge'
import { ClaudeBatchEquivalenceJudge } from '@/infrastructure/judging/ClaudeBatchEquivalenceJudge'
import { RecordingLogger } from '@/application/testing/RecordingLogger'

const CONFIG = { apiKey: 'test-key' }

function pair(id: string, left: string, right: string): EquivalenceQuestion {
  return {
    id,
    left: { name: left, brand: null, size: '1 kg' },
    right: { name: right, brand: null, size: '1 kg' },
  }
}

/** One result line as the API writes them. */
function succeeded(customId: string, verdicts: unknown): string {
  return JSON.stringify({
    custom_id: customId,
    result: {
      type: 'succeeded',
      message: { content: [{ type: 'text', text: JSON.stringify({ verdicts }) }] },
    },
  })
}

/**
 * A stand-in for the Batches API: takes a submission, reports a status per
 * poll, then hands back the lines.
 *
 * Written here rather than with FakeHttpClient because the point of the
 * batch flow is that the same URL answers differently over time, which a
 * table of canned routes cannot say.
 */
function stubApi(options: {
  statuses?: string[]
  lines?: string[]
  submitFails?: boolean
}): HttpClient & { submitted: unknown; polls: number } {
  const statuses = [...(options.statuses ?? ['ended'])]
  const state = { submitted: undefined as unknown, polls: 0 }

  return {
    ...state,
    get submitted() {
      return state.submitted
    },
    get polls() {
      return state.polls
    },
    async postJson(_url: string, body: unknown): Promise<HttpJsonResponse> {
      state.submitted = body
      if (options.submitFails) return { status: 'http-error', statusCode: 400, body: 'nope' }
      return { status: 'ok', statusCode: 200, body: { id: 'msgbatch_test' }, headers: {} }
    },
    async getJson(): Promise<HttpJsonResponse> {
      state.polls += 1
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]
      return {
        status: 'ok',
        statusCode: 200,
        body: {
          processing_status: status,
          request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
        },
        headers: {},
      }
    },
    async getText(): Promise<HttpTextResponse> {
      return {
        status: 'ok',
        statusCode: 200,
        body: `${(options.lines ?? []).join('\n')}\n`,
        headers: {},
      }
    },
  }
}

const noWait = async () => {}

describe('ClaudeBatchEquivalenceJudge', () => {
  it('sends every pair in one submission, 25 to a request', async () => {
    // The whole point: 1,618 requests handed over at once rather than
    // issued one at a time over several hours.
    const http = stubApi({ lines: [] })
    const questions = Array.from({ length: 60 }, (_, i) =>
      pair(`p${i}`, `Arroz ${i}`, `Arroz ${i}`),
    )

    await new ClaudeBatchEquivalenceJudge(CONFIG, http, new RecordingLogger(), noWait).judge(
      questions,
    )

    const requests = (http.submitted as { requests: unknown[] }).requests
    expect(requests).toHaveLength(3)
  })

  it('marks the instruction for caching, so it is not bought 1,618 times', async () => {
    const http = stubApi({ lines: [] })

    await new ClaudeBatchEquivalenceJudge(CONFIG, http, new RecordingLogger(), noWait).judge([
      pair('p1', 'Arroz', 'Arroz'),
    ])

    const [first] = (http.submitted as { requests: Array<{ params: { system: unknown } }> })
      .requests
    expect(first.params.system).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ])
  })

  it('waits for the batch to end before reading it', async () => {
    const http = stubApi({
      statuses: ['in_progress', 'in_progress', 'ended'],
      lines: [succeeded('pairs-0', [{ id: 'p1', same: true, reason: 'mesmo arroz' }])],
    })

    const verdicts = await new ClaudeBatchEquivalenceJudge(
      CONFIG,
      http,
      new RecordingLogger(),
      noWait,
    ).judge([pair('p1', 'Arroz', 'Arroz')])

    expect(http.polls).toBe(3)
    expect(verdicts).toEqual([{ id: 'p1', same: true, reason: 'mesmo arroz' }])
  })

  it('reads one verdict per line and keeps the ones it asked about', async () => {
    const http = stubApi({
      lines: [
        succeeded('pairs-0', [
          { id: 'p1', same: false, reason: 'marcas diferentes' },
          { id: 'ghost', same: true, reason: 'nunca perguntado' },
        ]),
      ],
    })

    const verdicts = await new ClaudeBatchEquivalenceJudge(
      CONFIG,
      http,
      new RecordingLogger(),
      noWait,
    ).judge([pair('p1', 'Arroz Tio João', 'Arroz Camil')])

    expect(verdicts).toEqual([{ id: 'p1', same: false, reason: 'marcas diferentes' }])
  })

  it('leaves a failed request pending rather than guessing for it', async () => {
    // errored, canceled and expired carry no message. Those pairs simply
    // stay unjudged, which a rerun picks up.
    const http = stubApi({
      lines: [
        JSON.stringify({ custom_id: 'pairs-0', result: { type: 'errored' } }),
        succeeded('pairs-25', [{ id: 'p2', same: false, reason: 'tamanhos diferentes' }]),
      ],
    })

    const verdicts = await new ClaudeBatchEquivalenceJudge(
      CONFIG,
      http,
      new RecordingLogger(),
      noWait,
    ).judge([pair('p1', 'A', 'B'), pair('p2', 'C', 'D')])

    expect(verdicts).toEqual([{ id: 'p2', same: false, reason: 'tamanhos diferentes' }])
  })

  it('answers nothing when the API will not take the batch', async () => {
    const http = stubApi({ submitFails: true })

    const verdicts = await new ClaudeBatchEquivalenceJudge(
      CONFIG,
      http,
      new RecordingLogger(),
      noWait,
    ).judge([pair('p1', 'A', 'B')])

    expect(verdicts).toEqual([])
    expect(http.polls).toBe(0)
  })

  it('gives up at the deadline rather than polling past the expiry', async () => {
    // A batch expires at 24 hours. Polling forever past that would be
    // waiting on requests the API has already thrown away.
    const http = stubApi({ statuses: ['in_progress'] })
    let clock = 0
    const judge = new ClaudeBatchEquivalenceJudge(
      CONFIG,
      http,
      new RecordingLogger(),
      async () => {
        clock += 60 * 60 * 1000
      },
      () => clock,
    )

    expect(await judge.judge([pair('p1', 'A', 'B')])).toEqual([])
    expect(http.polls).toBeLessThan(30)
  })
})
