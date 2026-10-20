/**
 * Asks a judge about the pairs the heuristic cannot decide, and keeps the
 * answers.
 *
 * Three stages, and the split is the point:
 *
 *   recall     a cheap word/size heuristic turns ~4 billion possible pairs
 *              into about twelve thousand worth asking about
 *   precision  a judge reads each shortlisted pair, once, ever
 *   apply      only pairs judged the same are merged
 *
 * Name similarity alone got about two thirds of them right, which is not
 * good enough to act on: it merged "Bolo de Brigadeiro" with "Bolo de
 * Brigadeiro com Amêndoas" and a 50-litre bin bag with a 100-litre one.
 * Every failure was a single word carrying the whole difference, which is
 * a reading problem rather than a threshold problem.
 *
 * Verdicts are stored both ways round. The negatives are most of the
 * value: a pair ruled different is never asked about or merged again.
 *
 * Usage:
 *   npx tsx scripts/judge-equivalences.ts                # how many are pending
 *   npx tsx scripts/judge-equivalences.ts --judge        # ask, and store
 *   npx tsx scripts/judge-equivalences.ts --judge --limit 200
 *   npx tsx scripts/judge-equivalences.ts --merge        # apply what was judged same
 *
 * Needs ANTHROPIC_API_KEY in .env.local for --judge, plus
 * ANTHROPIC_WORKSPACE_ID when the key belongs to an organisation rather
 * than to a single workspace. --merge needs neither.
 *
 * Complexity: recall is O(n) bucketing plus an inverted index per bucket;
 * judging is one request per batch of pairs; merging is one round trip per
 * chunk of groups.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import type { EquivalenceQuestion } from '@/application/ports/ProductEquivalenceJudge'
import { ApproximateProductMatcher } from '@/domain/services/ApproximateProductMatcher'
import { normalizeText } from '@/domain/text/normalizeText'
import { Quantity } from '@/domain/value-objects/Quantity'
import { readCollectorEnv } from '@/infrastructure/config/env'
import { FetchHttpClient } from '@/infrastructure/http/FetchHttpClient'
import { ClaudeEquivalenceJudge } from '@/infrastructure/judging/ClaudeEquivalenceJudge'
import { StructuredLogger } from '@/infrastructure/observability/StructuredLogger'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

type Row = {
  id: string
  name: string
  brand: string | null
  description: string | null
  image_url: string | null
  gtin14: string | null
  size_amount: number | string | null
  size_unit: string | null
  match_key: string
}

const PAGE = 1_000

/** Pairs per request. Small enough that one bad reply costs little. */
const BATCH = 25

/** Groups per merge round trip. */
const CHUNK = 300

/**
 * How common a word may be and still count as evidence of identity.
 *
 * "Phebo" and "envoltório" appear on a handful of rows; "vinho" and
 * "branco" appear on thousands. Without this the shortlist proposed
 * merging every white wine in the shop into one product.
 */
const RARE_WORD_SHARE = 0.002

const MIN_SHARED_WORDS = 2

async function main(): Promise<void> {
  const judging = process.argv.includes('--judge')
  const merging = process.argv.includes('--merge')
  const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity

  const client = createWriteClient(readCollectorEnv())
  const rows = await readProducts(client)
  const sized = rows.filter((row) => toQuantity(row) !== null)

  console.log(`catálogo: ${rows.length} produtos, ${sized.length} com tamanho`)

  const byId = new Map(sized.map((row) => [row.id, row]))
  const candidates = shortlist(sized)
  const decided = await readDecisions(client)

  const pending = candidates.filter(([a, b]) => !decided.has(pairKey(a, b)))
  console.log(`candidatos: ${candidates.length}`)
  console.log(`já julgados: ${candidates.length - pending.length}`)
  console.log(`pendentes: ${pending.length}`)

  if (judging) await judgePending(client, byId, pending.slice(0, limit))
  if (merging) await mergeJudgedSame(client, byId)

  if (!judging && !merging) console.log('\n(nada gravado — use --judge e depois --merge)')
}

async function readProducts(client: ReturnType<typeof createWriteClient>): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('products')
      .select('id, name, brand, description, image_url, gtin14, size_amount, size_unit, match_key')
      .order('id')
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/** Pairs already answered, in either direction. */
async function readDecisions(
  client: ReturnType<typeof createWriteClient>,
): Promise<Map<string, boolean>> {
  const decided = new Map<string, boolean>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('product_equivalences')
      .select('left_id, right_id, same')
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    const page = (data ?? []) as Array<{ left_id: string; right_id: string; same: boolean }>
    for (const row of page) decided.set(`${row.left_id}:${row.right_id}`, row.same)
    if (page.length < PAGE) break
  }
  return decided
}

/**
 * The recall stage: pairs worth asking a judge about.
 *
 * Same pack size, two shared words, at least one of them rare, brands that
 * do not contradict, barcodes that do not contradict, and the approximate
 * matcher willing to entertain it.
 *
 * Complexity: O(n) to bucket, then within a bucket an inverted word index
 * gives O(candidates) rather than O(k²) comparisons per product.
 */
function shortlist(sized: readonly Row[]): Array<[Row, Row]> {
  const matcher = new ApproximateProductMatcher()

  const frequency = new Map<string, number>()
  for (const row of sized) {
    for (const word of new Set(wordsOf(row.name))) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1)
    }
  }
  const rareCeiling = Math.max(2, Math.floor(sized.length * RARE_WORD_SHARE))
  const isRare = (word: string) => (frequency.get(word) ?? 0) <= rareCeiling

  const buckets = new Map<string, Row[]>()
  for (const row of sized) {
    const size = toQuantity(row)!
    const key = `${size.amount}${size.unit}`
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }

  const pairs: Array<[Row, Row]> = []

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue

    const words = bucket.map((row) => new Set(wordsOf(row.name)))
    const index = new Map<string, number[]>()
    for (const [position, set] of words.entries()) {
      for (const word of set) index.set(word, [...(index.get(word) ?? []), position])
    }

    for (let i = 0; i < bucket.length; i += 1) {
      const seen = new Map<number, number>()
      for (const word of words[i]) {
        for (const j of index.get(word) ?? []) {
          if (j > i) seen.set(j, (seen.get(j) ?? 0) + 1)
        }
      }

      for (const [j, shared] of seen) {
        if (shared < MIN_SHARED_WORDS) continue

        const a = bucket[i]
        const b = bucket[j]

        // Two barcodes that disagree are two products, whatever the names
        // say: it is the one identifier the shops themselves agree on.
        if (a.gtin14 && b.gtin14 && a.gtin14 !== b.gtin14) continue
        if (a.brand && b.brand && normalizeText(a.brand) !== normalizeText(b.brand)) continue

        const common = [...words[i]].filter((word) => words[j].has(word))
        if (!common.some(isRare)) continue

        const verdict = matcher.compare(
          { id: a.id, name: a.name, size: toQuantity(a) },
          { id: b.id, name: b.name, size: toQuantity(b) },
        )
        if (!verdict.confident) continue

        pairs.push(a.id < b.id ? [a, b] : [b, a])
      }
    }
  }

  return pairs
}

async function judgePending(
  client: ReturnType<typeof createWriteClient>,
  byId: Map<string, Row>,
  pending: Array<[Row, Row]>,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('\nfalta ANTHROPIC_API_KEY no .env.local')
    process.exitCode = 1
    return
  }

  const logger = new StructuredLogger({ level: 'warn' }).child({ job: 'judge' })
  const judge = new ClaudeEquivalenceJudge(
    { apiKey, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID },
    new FetchHttpClient(logger),
    logger,
  )

  let same = 0
  let different = 0
  let undecided = 0

  for (let index = 0; index < pending.length; index += BATCH) {
    const batch = pending.slice(index, index + BATCH)
    const questions: EquivalenceQuestion[] = batch.map(([a, b]) => ({
      id: pairKey(a, b),
      left: { name: a.name, brand: a.brand, size: sizeLabel(a) },
      right: { name: b.name, brand: b.brand, size: sizeLabel(b) },
    }))

    const verdicts = await judge.judge(questions)
    undecided += questions.length - verdicts.length

    const records = verdicts.flatMap((verdict) => {
      const [leftId, rightId] = verdict.id.split(':')
      if (!byId.has(leftId) || !byId.has(rightId)) return []

      if (verdict.same) same += 1
      else different += 1

      return [
        {
          left_id: leftId,
          right_id: rightId,
          same: verdict.same,
          reason: verdict.reason,
          decided_by: judge.name,
        },
      ]
    })

    if (records.length > 0) {
      const { error } = await client
        .from('product_equivalences')
        .upsert(records, { onConflict: 'left_id,right_id' })
      if (error) throw new Error(error.message)
    }

    console.log(
      `  ${Math.min(index + BATCH, pending.length)}/${pending.length}  ` +
        `iguais=${same} diferentes=${different} sem resposta=${undecided}`,
    )
  }
}

/** Applies every positive verdict, joining pairs into groups transitively. */
async function mergeJudgedSame(
  client: ReturnType<typeof createWriteClient>,
  byId: Map<string, Row>,
): Promise<void> {
  const { data, error } = await client
    .from('product_equivalences')
    .select('left_id, right_id')
    .eq('same', true)

  if (error) throw new Error(error.message)
  const positives = (data ?? []) as Array<{ left_id: string; right_id: string }>

  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!
    return root
  }

  for (const { left_id, right_id } of positives) {
    if (!byId.has(left_id) || !byId.has(right_id)) continue
    const [ra, rb] = [find(left_id), find(right_id)]
    if (ra !== rb) parent.set(ra, rb)
  }

  const byRoot = new Map<string, Row[]>()
  for (const id of new Set(positives.flatMap((p) => [p.left_id, p.right_id]))) {
    const row = byId.get(id)
    if (!row) continue
    const root = find(id)
    byRoot.set(root, [...(byRoot.get(root) ?? []), row])
  }

  const groups = [...byRoot.values()].filter((group) => group.length > 1)
  const absorbed = groups.reduce((total, group) => total + group.length - 1, 0)

  console.log(`\ngrupos julgados iguais: ${groups.length}, linhas absorvidas: ${absorbed}`)
  if (groups.length === 0) return

  const payload = groups.map((group) => {
    const [survivor, ...losers] = [...group].sort(bestFirst)
    return { key: survivor.match_key, survivor: survivor.id, losers: losers.map((r) => r.id) }
  })

  for (let index = 0; index < payload.length; index += CHUNK) {
    const { error: failed } = await client.rpc('merge_product_groups', {
      p_groups: payload.slice(index, index + CHUNK),
    })
    if (failed) throw new Error(failed.message)
    console.log(`  ${Math.min(index + CHUNK, payload.length)}/${payload.length}`)
  }
}

/** A barcode first: a survivor carrying one goes on merging without help. */
function bestFirst(a: Row, b: Row): number {
  const score = (row: Row) =>
    (row.gtin14 ? 8 : 0) + (row.image_url ? 4 : 0) + (row.description ? 2 : 0)

  return score(b) - score(a) || a.id.localeCompare(b.id)
}

const pairKey = (a: Row, b: Row) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`)

function sizeLabel(row: Row): string | null {
  const size = toQuantity(row)
  return size ? `${size.amount}${size.unit}` : null
}

function wordsOf(name: string): string[] {
  return normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
}

function toQuantity(row: Row): Quantity | null {
  if (row.size_amount === null || !row.size_unit) return null

  const amount = Number(row.size_amount)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return Quantity.of(amount, row.size_unit as Parameters<typeof Quantity.of>[1])
}

void main()
