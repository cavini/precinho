/**
 * What to run after a collection.
 *
 * Applying verdicts already in hand is free and must always happen: a
 * merge decided last week is undone by nothing, but a product collected
 * today under an absorbed name only lands in the right place because the
 * writer resolved it. Judging, by contrast, costs money or plan usage and
 * is only worth doing when there is something new to judge.
 *
 * So this separates them. It always merges, always reports, and never
 * judges on its own — the number it prints is how much judging is
 * waiting, which is the number worth watching rather than acting on
 * blindly.
 *
 * Usage: `npm run reconcile`
 *
 * Complexity: one shortlist pass over the catalogue, then one round trip
 * per chunk of merges.
 */
import { execFileSync } from 'node:child_process'

function run(args: string[]): string {
  return execFileSync('npx', ['tsx', 'scripts/judge-equivalences.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

// Apply first: verdicts already decided cost nothing to honour, and a
// grouping left unapplied is a duplicate on somebody's screen.
const merged = run(['--merge'])
for (const line of merged.split('\n')) if (line.includes('grupos')) console.log(line.trim())

// Then rebuild the ranking, because merging changes which products have
// two prices and the feed is ranked on exactly that.
execFileSync('npx', ['tsx', 'scripts/refresh-feed.ts'], { stdio: 'inherit' })

// Weekly, not nightly. Counting what is pending means building the
// shortlist, which means reading the catalogue — 84.8 MB, measured. The
// number it prints is a thing to watch, not to act on, and watching it
// every night cost more egress in a month than the whole allowance.
// Mondays, so it lands at the start of a week rather than never.
//
// `npm run reconcile -- --count` forces it, for when the answer is wanted
// today.
const forced = process.argv.includes('--count')
if (forced || new Date().getUTCDay() === 1) {
  const pending = run(['--count'])
  for (const line of pending.split('\n')) {
    if (line.includes('candidatos') || line.includes('pendentes') || line.includes('praça')) {
      console.log(line.trim())
    }
  }
} else {
  console.log('\ncontagem de pendentes: segundas-feiras (ou --count para agora)')
}

console.log(
  '\npares pendentes são pares que nenhum juiz viu ainda.\n' +
    'para julgá-los: npx tsx scripts/judge-equivalences.ts --judge   (precisa de ANTHROPIC_API_KEY)\n' +
    'ou exporte com --export e julgue com agentes, como em .judging/COMO-RETOMAR.md',
)
