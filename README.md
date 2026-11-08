# Precinho

Compare grocery prices across ten supermarket chains in Taubaté, with a direct
link to each store's product page.

Search a product, the listing shows the cheapest price and where; open it and
you get every store's price, the price per kilo or litre, and a link.
Portuguese or English — the switch is in the header, and it changes the words
and nothing else.

https://github.com/user-attachments/assets/44c99e38-6b02-4c74-9954-76608aae547a

## Why it covers one town

Online grocery prices in Brazil are regional — the same chain charges
different amounts depending on which branch serves your address. The collector
resolves the region's trading area from each store's own API before sweeping
it, so what is stored is what somebody there would actually pay.

It swept five regions once, to prove the collector could read each platform at
all. That was 26 shops and about 237 minutes a night, most of it spent on
shops nobody using this could buy from. One region is 10 shops and about 78
minutes, and the two thirds saved is not only ours: it is requests that stop
arriving at stores we had no reason to ask.

It stays at one for a plainer reason. The database sits at 344 MB of the 500
MB the free tier allows, and a second region of this size would not fit. The
old regions are deactivated rather than deleted, so turning one back on is an
update — on a plan with room for it.

Measured on 2026-10-19, same barcode, same week, two São Paulo chains:

| Product         | Mambo    | Hortifruti   |
| --------------- | -------- | ------------ |
| Coca-Cola 2L    | R$ 14,98 | **R$ 10,49** |
| Coca-Cola 600ml | R$ 6,89  | **R$ 5,69**  |

That 30% is the whole reason this exists.

## Architecture

Four layers, dependencies pointing inward only:

```
domain/          pure rules — Money, Quantity, Ean, offer comparison. No imports out.
  ↑
application/     use cases and ports. Knows no vendor.
  ↑
infrastructure/  adapters — Supabase, VTEX catalogues, ViaCEP, logging, rate limits.
presentation/    Next.js routes and components.
composition/     the only module that wires concretions together.
```

A few decisions worth knowing before reading the code:

- **Products are matched in three steps, in order of how much each can be
  trusted.** A barcode verified by its GS1 check digit and normalised to 14
  digits merges across stores. Without one, a full catalogue name plus a
  parsed pack size also merges — four in five rows here carry no barcode, and
  keeping those store-local meant the same bar of soap existed once per shop,
  comparing nothing. With neither, the product stays store-local: loose
  produce has no barcode and no pack size, and "Banana Prata" at two chains is
  each shop's own fruit. A wrong merge quotes a shopper the price of a
  different product, which is worse than showing no comparison.
- **What the heuristic cannot decide, Claude decides.** A cheap word-and-size
  pass turns roughly four billion possible pairs into tens of thousands worth
  asking about, and each one is read once, ever. "Bolo de Brigadeiro" and
  "Bolo de Brigadeiro com Amêndoas" share every word but one, and that word is
  the product — so the prompt is written against the pairs a similarity score
  got wrong, and the judge is told to answer `false` whenever it is unsure.
  Verdicts are stored both ways: a pair ruled different is never asked about
  again. The whole backlog goes through the Message Batches API at half price.
- **A merge trusts a pair, not a chain of them.** Verdicts are pairwise and
  groups are transitive, which is where a pile of plausible answers becomes
  one wrong product: a group of 17 once held three different coffee lines. A
  group is refused when any pair inside it was judged _different_, or when its
  members disagree about brand or barcode.
- **Offers are written, never updated, and pruned.** A store's current price
  is its most recent row, and the index on `(product_id, store_id,
collected_at desc)` is what the whole read path leans on. They were
  append-only until eight nights of collecting bought 1,085,069 rows to serve
  131,777 of them and spent 99.5% of the 500 MB allowed. Now a nightly prune
  keeps three days of superseded history and never touches the most recent row
  for a pair, whatever its age — losing that one does not show a stale price,
  it takes the store off the product's page.
- **Out-of-stock prices never win a comparison.** Quoting a price nobody can
  buy is the fastest way to make the site useless.
- **Price per unit is computed and shown**, because a 350ml can at R$ 3,99
  costs less than a 2L bottle at R$ 10,49 and is twice the price per litre.
- **The shops you picked live in a cookie**, not the database. There is no
  login, so there is nobody for a stored preference to belong to — and a
  cookie is readable during server rendering, so the first paint already shows
  the right shops. The CEP used to live there too, back when a visitor had to
  say where they were; one covered area answers that before anyone types.

## Rate limiting

Two separate problems, handled separately.

The query itself is capped in length and in token count by `SearchQuery`,
because every token becomes a database predicate and twenty of them turns one
cheap request into an expensive scan — the attack lands on the database, not
the API. Tokens are alphanumeric runs, so no SQL or wildcard syntax survives
tokenisation.

Volume is a token bucket, kept in the domain as pure arithmetic over stored
state. A fast in-memory limiter sits in front of a shared one in Postgres: the
in-memory one rejects an obvious flood without a round trip, and the shared
one is what makes the limit real across serverless instances. Caller addresses
are hashed with a per-deployment salt and never stored or logged raw.

## Tests

```bash
npm test                  # 725 tests
npx vitest run --coverage # thresholds enforced, not aspirational
```

- **Unit** on the domain and application layers. The coverage threshold is
  100% lines there; it has already caught a layering mistake and a real bug.
- **Contract** suites that every implementation of a port must pass — the
  in-memory and Postgres rate limiters are held to the same one, which is the
  only thing that stops them drifting.
- **Integration** against payloads recorded from the live store and CEP APIs,
  in `tests/fixtures/`. Those recordings are why the mapping handles an
  8-digit barcode, a `Price: 0` meaning unlisted, and ViaCEP's not-found
  marker being the string `"true"` rather than a boolean.

## Setup

Two steps need your accounts; the rest is in the repo.

### 1. Supabase

Create a project, then apply the migrations in order. There are 67 of them,
so run them with the script rather than by hand in the SQL editor:

```bash
npm run migrate
```

The seed adds the regions and the store rows whose catalogue APIs I verified
answering. Ten of those stores are active, all in one region; the rest are
deactivated rather than deleted, and turning one back on is an update. Adding
a chain that runs on a platform already supported is a row in `stores`, not a
deploy.

Copy `.env.example` to `.env.local` and fill in the values from
**Project Settings → API**.

### 2. Vercel

```bash
vercel link
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add RATE_LIMIT_SALT
vercel deploy --prod
```

Do **not** put `SUPABASE_SERVICE_ROLE_KEY` in Vercel. It bypasses row level
security and the site only ever reads; it belongs in the collector's GitHub
secrets alone.

### 3. Collecting prices

The collector runs in **GitHub Actions**, not Vercel Cron — a sweep takes
minutes and a Hobby serverless function is capped at sixty seconds with one
cron invocation a day.

Add `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as
repository secrets. `.github/workflows/collect.yml` then runs nightly, and
can be triggered by hand for named stores.

Locally:

```bash
npm run collect              # every active store
npm run collect mambo        # one store
```

It paces itself between requests. Thirty search terms fired back to back from
one address looks like an attack and gets the collector blocked, which costs
far more than the time saved.

## Where the prices come from

The public catalogue APIs of each chain's own storefront — the same data their
website shows you, read politely and attributed with a link back. Every price
on the site links to the store's product page, and the footer says to confirm
there before buying.

Not every chain can be read. `docs/chains-ruled-out.md` records the ones
investigated and found to publish no structured prices, with the evidence,
so the same couple of hours is not spent twice.

## What is not built yet

- Trusting a barcode less. A shop that publishes a multipack's barcode on a
  single-unit page attaches its price to the wrong product, and the barcode
  rule short-circuits every name and size check that would have caught it.
  The prices a shopper sees are guarded — a price far outside the middle of
  the others is refused — but the match underneath is still wrong.
- Price history is recorded and pruned to three days, and nothing reads it.
  Three days is what a collector needs to check a new price against a previous
  one; it is not yet a feature.
- End-to-end browser tests. The layers below are covered; the screens are not,
  and every visual fault so far has been found by a person rather than a test.
- A second region, which the free tier will not hold. See the top.

Landed since this list was first written: relevance ranking now reads the
query rather than only counting shops, and approximate matching is wired in
behind the Claude judge.
