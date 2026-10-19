import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import { ViaCepAddressLookup } from '@/infrastructure/gateways/viacep/ViaCepAddressLookup'
import type { FakeResponse } from '@/infrastructure/testing/FakeHttpClient'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, `../fixtures/${name}`), 'utf8'))
}

/** Both recorded from viacep.com.br on 2026-10-19. */
const PAULISTA = fixture('viacep-01310100.json')
const NOT_FOUND = fixture('viacep-not-found.json')

function build(response: FakeResponse) {
  const http = new FakeHttpClient([{ match: /viacep\.com\.br/, response }])
  const logger = new RecordingLogger()
  return { lookup: new ViaCepAddressLookup(http, logger), http, logger }
}

const CEP = PostalCode.tryParse('01310100')!

describe('ViaCepAddressLookup against recorded responses', () => {
  it('reads city, state and neighbourhood', async () => {
    const { lookup } = build({ status: 'ok', statusCode: 200, body: PAULISTA })
    const result = await lookup.byPostalCode(CEP)

    expect(result).toEqual({
      status: 'found',
      address: { city: 'São Paulo', uf: 'SP', neighbourhood: 'Bela Vista' },
    })
  })

  it('asks for the CEP as eight digits', async () => {
    const { lookup, http } = build({ status: 'ok', statusCode: 200, body: PAULISTA })
    await lookup.byPostalCode(CEP)
    expect(http.lastUrl).toBe('https://viacep.com.br/ws/01310100/json/')
  })

  it('recognises the not-found marker, which is the string "true"', async () => {
    // Not a boolean. Comparing with === true would read every bad CEP as found.
    expect(NOT_FOUND).toEqual({ erro: 'true' })

    const { lookup } = build({ status: 'ok', statusCode: 200, body: NOT_FOUND })
    expect(await lookup.byPostalCode(CEP)).toEqual({ status: 'not-found' })
  })

  it('also accepts a boolean marker, in case that ever changes', async () => {
    const { lookup } = build({ status: 'ok', statusCode: 200, body: { erro: true } })
    expect(await lookup.byPostalCode(CEP)).toEqual({ status: 'not-found' })
  })

  it('keeps a short timeout, because somebody is waiting on the field', async () => {
    const { lookup, http } = build({ status: 'ok', statusCode: 200, body: PAULISTA })
    await lookup.byPostalCode(CEP)
    expect(http.requests[0].options?.timeoutMs).toBeLessThanOrEqual(6_000)
  })
})

describe('ViaCepAddressLookup mapping', () => {
  it('reports no neighbourhood rather than an empty string', async () => {
    // Small towns come back with bairro: "".
    const body = { localidade: 'Bariri', uf: 'SP', bairro: '' }
    const { lookup } = build({ status: 'ok', statusCode: 200, body })

    const result = await lookup.byPostalCode(CEP)
    if (result.status !== 'found') throw new Error(result.status)
    expect(result.address.neighbourhood).toBeNull()
  })

  it('upper-cases the state code', async () => {
    const body = { localidade: 'Curitiba', uf: 'pr', bairro: 'Centro' }
    const { lookup } = build({ status: 'ok', statusCode: 200, body })

    const result = await lookup.byPostalCode(CEP)
    if (result.status !== 'found') throw new Error(result.status)
    expect(result.address.uf).toBe('PR')
  })

  it.each([
    { label: 'no city', body: { uf: 'SP' } },
    { label: 'no state', body: { localidade: 'São Paulo' } },
    { label: 'an array', body: [] },
    { label: 'a string', body: 'nope' },
    { label: 'null', body: null },
  ])('treats a response with $label as not-found', async ({ body }) => {
    const { lookup } = build({ status: 'ok', statusCode: 200, body })
    expect(await lookup.byPostalCode(CEP)).toEqual({ status: 'not-found' })
  })
})

describe('ViaCepAddressLookup when ViaCEP will not answer', () => {
  it.each([400, 404])('reads %s as a CEP that does not exist', async (statusCode) => {
    const { lookup } = build({ status: 'http-error', statusCode })
    expect(await lookup.byPostalCode(CEP)).toEqual({ status: 'not-found' })
  })

  it.each([
    { label: 'a 500', response: { status: 'http-error', statusCode: 500 } },
    { label: 'a timeout', response: { status: 'timeout' } },
    { label: 'a connection failure', response: { status: 'network-error', reason: 'ECONNRESET' } },
    { label: 'a broken body', response: { status: 'invalid-json' } },
  ] as const)('reports $label as unavailable, not as a bad CEP', async ({ response }) => {
    // Telling somebody their valid CEP is wrong because our dependency is
    // down is the one outcome worth separating.
    const { lookup, logger } = build(response)

    expect(await lookup.byPostalCode(CEP)).toEqual({ status: 'unavailable' })
    expect(logger.lines.some((line) => line.message.startsWith('viacep.'))).toBe(true)
  })
})
