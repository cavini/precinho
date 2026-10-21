-- Search stops running the expensive test on rows the cheap one rejects.
--
-- After the price aggregate was fixed, the candidate scan was what was
-- left: a regex against the search_text of all 76,876 products, roughly
-- 100ms warm and considerably more against a cold buffer cache. It is
-- the reason "sabonete" still took 2.3s end to end in production.
--
-- `search_text ~ '\mtok'` means the token appears at the start of a
-- word. That implies `search_text like '%tok%'` — if it matches at a
-- word start, the substring is present. The converse does not hold,
-- which is the point: the cheap test can reject, never admit, so it
-- changes nothing about which products qualify while sparing the regex
-- the 75,000 rows that were never going to match.
--
-- Candidate stage: 97ms to 35ms. The whole search for "sabonete": 573ms
-- to 205ms. Verified against the function it replaces on 20 terms at two
-- offsets, comparing full result sets: identical on all 40.
--
-- A tsvector index was the obvious alternative and it is wrong here.
-- `to_tsvector('simple', ...)` reads "salg.arroz" as one token, so a
-- search for arroz loses that product and four others like it. Narrower
-- results are not a performance win.

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
    -- Cheap test first. `like '%tok%'` is implied by the regex — a match
    -- at a word start means the substring is somewhere in the text — so
    -- adding it cannot change which products qualify. It only spares the
    -- regex from being run against the 75,000 rows that cannot match.
    where p.search_text like all (
      array(select '%' || tok || '%' from unnest(p_tokens) as tok)
    )
      and p.search_text ~ all (
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
