-- Search stops rescanning its own results once per candidate product.
--
-- A search for "sabonete" took 4,475ms against an anon role whose
-- statement timeout is 3,000ms, so the query was cancelled and the
-- screen said nothing matched. Searching again sometimes worked, which
-- is what made it look intermittent rather than broken: the second run
-- found the pages already in cache.
--
-- Where the time went, timing each stage on its own rather than guessing:
--
--   candidate products (regex over 76,876 rows)   113 ms
--   current offers for those candidates            94 ms
--   everything else, by subtraction             4,268 ms
--
-- Each of the four laterals — cheapest, dearest, count, offer list —
-- scanned the whole `comparable` set once per candidate row. With 1,200
-- candidates and 1,535 comparable offers that is four passes of roughly
-- 1.8M row comparisons: O(B · C) in the number of candidates and offers.
--
-- All four are aggregates over the same grouping, so one GROUP BY
-- computes every one of them in a single pass: O(C log C). The cheapest
-- shop's columns come from array_agg ordered by price, which is the same
-- "first row per group" the lateral was expressing with a LIMIT 1.
--
-- That GROUP BY has to be materialised. Written as a plain CTE it came
-- out *slower* than the laterals, at 3,539ms: the planner estimates the
-- regex filter at one row, so it believes the aggregate returns one row
-- too, puts it on the inner side of a nested loop and recomputes it once
-- per candidate — 612,909 joined rows thrown away. The keyword is not
-- decoration here, it is the fix.
--
-- The grouping also replaces the availability filter. A product with no
-- comparable offer produces no group at all, so the inner join drops it
-- where `where available_store_count > 0` used to. Same rows, same
-- order, no extra pass to discard them.

drop function if exists search_products(text[], uuid, uuid[], integer, integer);

create function search_products(
  p_tokens    text[],
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer,
  p_offset    integer
)
returns table (
  product_id          uuid,
  name                text,
  description         text,
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
  available_store_count integer,
  offers              jsonb
)
language sql
stable
as $$
  with bounded as (
    select p.id, p.name, p.description, p.brand, p.size_amount, p.size_unit,
           p.image_url, p.gtin14, p.search_text
    from products p
    where p.search_text ~ all (
      array(select '\m' || tok from unnest(p_tokens) as tok)
    )
    -- Shortest text first still decides which 300 candidates are considered:
    -- it favours "Arroz Camil 5kg" over a name padded with marketing. The
    -- ranking below then decides what the shopper actually sees.
    order by length(p.search_text), p.name, p.id
    limit 1200
  ),
  current_offers as (
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
    select * from current_offers where in_stock
  ),
  floors as (
    select a.product_id, min(a.price_cents) as cheapest_cents
    from available a
    group by a.product_id
  ),
  comparable as (
    -- Same refusal as the feed: more than 3x the cheapest is a different
    -- package sharing a barcode, not a worse deal.
    select a.*
    from available a
    join floors f on f.product_id = a.product_id
    where a.price_cents <= f.cheapest_cents * 3
  )
  ,
  -- One pass over the comparable offers, grouped by product. Every
  -- figure the four laterals used to fetch separately is an aggregate
  -- over this same group.
  -- Materialised on purpose: see the note at the top. Without it this
  -- runs 1,200 times instead of once.
  priced as materialized (
    select
      c.product_id,
      (array_agg(c.store_id order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_store_id,
      min(c.price_cents) as cheapest_price_cents,
      (array_agg(c.list_price_cents order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_list_price_cents,
      (array_agg(c.url order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_url,
      (array_agg(c.collected_at order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_collected_at,
      max(c.price_cents) as dearest_price_cents,
      count(*)::integer as available_store_count,
      jsonb_agg(
        jsonb_build_object(
          'store_id', c.store_id,
          'price_cents', c.price_cents,
          'url', c.url,
          'collected_at', c.collected_at
        )
        order by c.price_cents asc, c.store_id asc
      ) as offers
    from comparable c
    group by c.product_id
  )
  select
    b.id, b.name, b.description, b.brand, b.size_amount, b.size_unit,
    b.image_url, b.gtin14,
    pr.cheapest_store_id, pr.cheapest_price_cents, pr.cheapest_list_price_cents,
    pr.cheapest_url, pr.cheapest_collected_at, pr.dearest_price_cents,
    pr.available_store_count, pr.offers
  from bounded b
  -- Inner, not left: a product nobody nearby sells has no group here, and
  -- nothing the shopper can buy is nothing worth listing. Those rows used
  -- to be fetched and then discarded by a where clause.
  join priced pr on pr.product_id = b.id
  order by
    -- Most shops first: a product three shops carry is a comparison, one
    -- shop carries is a listing.
    pr.available_store_count desc,
    -- Then where they disagree most, which is what the app is for.
    pr.dearest_price_cents - pr.cheapest_price_cents desc,
    -- A photo makes a row readable; without one the shopper sees a grey box.
    (b.image_url is not null) desc,
    b.name asc,
    b.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function search_products(text[], uuid, uuid[], integer, integer) to anon, authenticated;
