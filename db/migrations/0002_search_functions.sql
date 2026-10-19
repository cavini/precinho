-- Read path.
--
-- Both queries are functions rather than client-side query builders for one
-- reason: "the latest offer per store" needs DISTINCT ON, which no ORM
-- expresses, and doing it in the client would mean shipping price history
-- over the wire to throw most of it away.

-- ---------------------------------------------------------------------------
-- search_products
-- ---------------------------------------------------------------------------

-- Returns one row per matching product with the cheapest and dearest in-stock
-- price among the stores the shopper picked.
--
-- Complexity: the trigram index narrows candidates, the candidate set is then
-- capped, and offers are read through offers_current_idx, so the work is
-- O(candidates * stores_picked) index lookups rather than a scan of history.
-- Out goes one row per product, not one per offer.
create or replace function search_products(
  p_tokens    text[],
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer
)
returns table (
  product_id          uuid,
  name                text,
  brand               text,
  size_amount         numeric,
  size_unit           text,
  image_url           text,
  gtin14              char(14),
  cheapest_store_id   uuid,
  cheapest_price_cents integer,
  cheapest_list_price_cents integer,
  cheapest_url        text,
  cheapest_collected_at timestamptz,
  dearest_price_cents integer,
  available_store_count integer
)
language sql
stable
as $$
  with bounded as (
    -- Every token must appear. Tokens arrive alphanumeric-only from
    -- SearchQuery, so no wildcard can reach the pattern.
    select p.id, p.name, p.brand, p.size_amount, p.size_unit, p.image_url,
           p.gtin14, p.search_text
    from products p
    where p.search_text like all (
      array(select '%' || tok || '%' from unnest(p_tokens) as tok)
    )
    -- Ordered before the cap so the candidate set is deterministic, and
    -- capped so one request cannot drag the whole catalogue in.
    order by length(p.search_text), p.name, p.id
    limit 300
  ),
  current_offers as (
    -- One row per (product, store): the most recent. Older rows are history.
    select distinct on (o.product_id, o.store_id)
      o.product_id, o.store_id, o.price_cents, o.list_price_cents,
      o.url, o.in_stock, o.collected_at
    from offers o
    join stores s on s.id = o.store_id
    where o.product_id in (select id from bounded)
      and o.store_id = any (p_store_ids)
      and s.region_id = p_region_id
      and s.active
    order by o.product_id, o.store_id, o.collected_at desc
  ),
  available as (
    -- Out-of-stock prices never win a comparison, so they are excluded here
    -- rather than filtered on the way out.
    select * from current_offers where in_stock
  )
  select
    b.id,
    b.name,
    b.brand,
    b.size_amount,
    b.size_unit,
    b.image_url,
    b.gtin14,
    cheap.store_id,
    cheap.price_cents,
    cheap.list_price_cents,
    cheap.url,
    cheap.collected_at,
    dear.price_cents,
    coalesce(counted.available_store_count, 0)::integer
  from bounded b
  left join lateral (
    select a.store_id, a.price_cents, a.list_price_cents, a.url, a.collected_at
    from available a
    where a.product_id = b.id
    -- Store id breaks a tie, so the same request always names the same store.
    order by a.price_cents asc, a.store_id asc
    limit 1
  ) cheap on true
  left join lateral (
    select a.price_cents
    from available a
    where a.product_id = b.id
    order by a.price_cents desc, a.store_id desc
    limit 1
  ) dear on true
  left join lateral (
    select count(*)::integer as available_store_count
    from available a
    where a.product_id = b.id
  ) counted on true
  -- Products somebody can actually buy first, then a stable order.
  order by (coalesce(counted.available_store_count, 0) > 0) desc, b.name asc, b.id asc
  limit least(greatest(p_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- product_offers
-- ---------------------------------------------------------------------------

-- Every current offer for one product among the given stores, newest row per
-- store. Ranking is left to the domain's comparator rather than restated here.
--
-- Complexity: O(stores_picked) index lookups via offers_current_idx.
create or replace function product_offers(
  p_product_id uuid,
  p_store_ids  uuid[]
)
returns table (
  store_id         uuid,
  price_cents      integer,
  list_price_cents integer,
  url              text,
  in_stock         boolean,
  collected_at     timestamptz
)
language sql
stable
as $$
  select distinct on (o.store_id)
    o.store_id, o.price_cents, o.list_price_cents, o.url, o.in_stock, o.collected_at
  from offers o
  join stores s on s.id = o.store_id
  where o.product_id = p_product_id
    and o.store_id = any (p_store_ids)
    and s.active
  order by o.store_id, o.collected_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Rate limit storage
-- ---------------------------------------------------------------------------

-- Reads a bucket. Security definer because the anon key has no rights on the
-- table itself — it may only go through these two functions.
create or replace function read_rate_limit(p_key text)
returns table (tokens double precision, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.tokens, b.updated_at from rate_limit_buckets b where b.key = p_key;
$$;

-- Writes a bucket with a compare-and-set.
--
-- The caller computes the new state with the domain's TokenBucket, so the
-- algorithm exists once. p_expected_updated_at is the state the caller read:
-- null means "I saw no row". A false return means somebody else got there
-- first, and the caller retries or denies.
create or replace function write_rate_limit(
  p_key                  text,
  p_tokens               double precision,
  p_updated_at           timestamptz,
  p_expected_updated_at  timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_expected_updated_at is null then
    insert into rate_limit_buckets (key, tokens, updated_at)
    values (p_key, p_tokens, p_updated_at)
    on conflict (key) do nothing;

    get diagnostics v_rows = row_count;
    return v_rows = 1;
  end if;

  update rate_limit_buckets
     set tokens = p_tokens,
         updated_at = p_updated_at
   where key = p_key
     and updated_at = p_expected_updated_at;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Housekeeping: buckets that have had time to refill completely are
-- indistinguishable from absent ones, so they can go.
create or replace function prune_rate_limit_buckets(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  delete from rate_limit_buckets where updated_at < now() - p_older_than;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

grant execute on function search_products(text[], uuid, uuid[], integer) to anon, authenticated;
grant execute on function product_offers(uuid, uuid[]) to anon, authenticated;
grant execute on function read_rate_limit(text) to anon, authenticated;
grant execute on function write_rate_limit(text, double precision, timestamptz, timestamptz) to anon, authenticated;
