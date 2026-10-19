-- Precinho: regional grocery price comparison.
--
-- Shape of the data: a region is a trading area, a store sells in exactly one
-- region, a product is identified across stores by its barcode, and an offer
-- is one store's price for one product at one moment.
--
-- Offers are append-only. A collection run inserts rather than updates, so a
-- store's current price is simply its most recent row and price history is a
-- by-product of collecting rather than a second feature.

create extension if not exists "pgcrypto";   -- gen_random_uuid
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";    -- fuzzy product search

-- ---------------------------------------------------------------------------
-- Regions
-- ---------------------------------------------------------------------------

create table if not exists regions (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  city          text not null,
  uf            char(2) not null,
  -- Where CEPs in this state land when their own city is not covered.
  is_uf_default boolean not null default false,
  -- Representative CEP the collector shops from, so prices are this area's.
  probe_cep     char(8) not null,
  created_at    timestamptz not null default now(),

  constraint regions_uf_upper check (uf = upper(uf)),
  constraint regions_probe_cep_digits check (probe_cep ~ '^[0-9]{8}$')
);

-- At most one default per state; RegionSelector refuses to guess otherwise.
create unique index if not exists regions_one_default_per_uf
  on regions (uf) where is_uf_default;

-- ---------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------

create table if not exists stores (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  chain         text not null,
  region_id     uuid not null references regions (id) on delete cascade,

  -- Collection configuration. Kept with the store row rather than in code so
  -- adding a chain on a platform we already read is a row, not a deploy.
  platform      text not null,
  host          text not null,
  sales_channel text,
  -- Trading-area token from the store's own regions endpoint. Without it the
  -- catalogue answers with default-area prices.
  region_token  text,
  active        boolean not null default true,

  created_at    timestamptz not null default now(),

  constraint stores_platform_known check (platform in ('vtex-legacy'))
);

create index if not exists stores_region_active_idx
  on stores (region_id) where active;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  -- Identity across stores and runs: 'gtin:<14 digits>' when the barcode
  -- verified, 'store:<slug>:<name>' when it did not.
  match_key   text not null unique,
  -- Null when no verifiable barcode was given.
  gtin14      char(14),
  name        text not null,
  brand       text,
  size_amount numeric(12, 4),
  size_unit   text,
  image_url   text,
  -- Normalised name plus brand. Written by the same normalisation the search
  -- uses; if the two ever diverge, products become unreachable.
  search_text text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint products_size_unit_known check (size_unit is null or size_unit in ('kg', 'L', 'un')),
  constraint products_size_positive check (size_amount is null or size_amount > 0),
  constraint products_gtin14_digits check (gtin14 is null or gtin14 ~ '^[0-9]{14}$')
);

-- Trigram index: what makes a LIKE '%term%' search sargable at all.
create index if not exists products_search_text_trgm_idx
  on products using gin (search_text gin_trgm_ops);

create unique index if not exists products_gtin14_idx
  on products (gtin14) where gtin14 is not null;

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------

create table if not exists offers (
  id              bigint generated always as identity primary key,
  product_id      uuid not null references products (id) on delete cascade,
  store_id        uuid not null references stores (id) on delete cascade,
  price_cents     integer not null,
  list_price_cents integer,
  url             text not null,
  in_stock        boolean not null,
  collected_at    timestamptz not null default now(),

  -- A zero price means the catalogue did not price the item; the collector
  -- drops those rather than storing a free product.
  constraint offers_price_positive check (price_cents > 0),
  constraint offers_list_price_positive check (list_price_cents is null or list_price_cents > 0),
  constraint offers_url_absolute check (url ~ '^https?://')
);

-- The index the whole read path depends on: it turns "latest offer per
-- (product, store)" into an index scan instead of a sort over history.
create index if not exists offers_current_idx
  on offers (product_id, store_id, collected_at desc);

-- For pruning old history and for per-store collection reports.
create index if not exists offers_store_collected_idx
  on offers (store_id, collected_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

-- Storage only. The token-bucket arithmetic lives in the domain and runs in
-- the application, written back with a compare-and-set, so there is exactly
-- one implementation of the algorithm rather than one here and one in TypeScript.
create table if not exists rate_limit_buckets (
  key        text primary key,
  tokens     double precision not null,
  updated_at timestamptz not null
);

create index if not exists rate_limit_buckets_updated_idx
  on rate_limit_buckets (updated_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Catalogue data is public and read-only to the site. Writes happen only
-- through the service role, which the collector uses and which bypasses RLS.
alter table regions enable row level security;
alter table stores  enable row level security;
alter table products enable row level security;
alter table offers  enable row level security;
alter table rate_limit_buckets enable row level security;

drop policy if exists regions_public_read on regions;
create policy regions_public_read on regions for select using (true);

drop policy if exists stores_public_read on stores;
create policy stores_public_read on stores for select using (active);

drop policy if exists products_public_read on products;
create policy products_public_read on products for select using (true);

drop policy if exists offers_public_read on offers;
create policy offers_public_read on offers for select using (true);

-- No policy on rate_limit_buckets: it is reached only through the security
-- definer functions below, never directly by the anon key.
