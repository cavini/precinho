# Precinho

Compare grocery prices across the chains you actually shop at, for your own
CEP, with a direct link to each store's product page.

Search a product, the listing shows the cheapest price and where; open it and
you get every store's price, the price per kilo or litre, and a link.

## Why the CEP matters

Online grocery prices in Brazil are regional — the same chain charges
different amounts depending on which branch serves your address. So the CEP
is not a nicety, it decides every price on the site. The collector resolves
each region's trading area from the store's own API before sweeping it, so
what is stored is what somebody at that address would actually pay.

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

- **Products are matched on their barcode**, verified by its GS1 check digit,
  normalised to 14 digits so a store reporting EAN-13 and one reporting
  GTIN-14 land on the same product. Anything without a verifiable barcode
  stays store-local: loose produce has none, and "Banana Prata" at two chains
  is not provably the same item. A wrong merge quotes a shopper the price of
  a different product, which is worse than showing no comparison.
- **Offers are append-only.** A store's current price is its most recent row,
  which makes price history a by-product rather than a second feature. The
  index on `(product_id, store_id, collected_at desc)` is what the whole read
  path leans on.
- **Out-of-stock prices never win a comparison.** Quoting a price nobody can
  buy is the fastest way to make the site useless.
- **Price per unit is computed and shown**, because a 350ml can at R$ 3,99
  costs less than a 2L bottle at R$ 10,49 and is twice the price per litre.
- **Your CEP and chosen stores live in a cookie**, not the database. There is
  no login, so there is nobody for a stored preference to belong to — and a
  cookie is readable during server rendering, so the first paint already
  shows the right region.

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
npm test                  # 365 tests
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

Create a project, then run the migrations in the SQL editor, in order:

```
db/migrations/0001_init.sql
db/migrations/0002_search_functions.sql
db/seed.sql
```

The seed adds three regions (São Paulo, Rio de Janeiro, Curitiba) and the
seven store rows whose catalogue APIs I verified answering. Adding a chain
that runs on a platform already supported is a row in `stores`, not a deploy.

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

- Relevance ranking. Search requires every token to match, then ranks by how
  many shops carry the product and how much they disagree. That surfaces real
  comparisons, but it is not relevance: trigram similarity is the obvious next
  step, and it has to land in the SQL function and the in-memory reference
  implementation at once.
- Price history is being recorded but nothing reads it yet.
- Approximate matching. A barcode merges across shops, and so does a full
  catalogue name with a pack size, which covers most of the catalogue. Two
  shops that name the same packaged item differently still produce two rows;
  `ApproximateProductMatcher` exists for that case and is not yet wired in.
- End-to-end browser tests. The layers below are covered; the screens are not,
  and every visual fault so far has been found by a person rather than a
  test.
