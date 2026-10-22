-- A two-character search stops paying for an index that cannot help it.
--
-- My own regression, from 0055 an hour ago. A trigram is three characters,
-- so pg_trgm cannot index a pattern shorter than that — it answers
-- `like '%ar%'` by walking every entry in the index and then visiting every
-- heap page they point at, which is the sequential scan 0055 replaced with
-- the index read added on top.
--
-- Best of three interleaved runs against the function 0055 replaced:
--
--   tokens   before (0053)      after (0055)       this
--   ar       148ms  18,380 blk  278ms  20,718 blk  back to 0053's plan
--   po       135ms  18,324      259ms  20,662      back to 0053's plan
--   tv        38ms   5,727      157ms   8,065      back to 0053's plan
--
-- Reachable: SearchQuery keeps any token of two characters or more, so
-- "tv", "ar", "pó" and "kg" are all real queries a shopper can type.
--
-- Two branches rather than an OR. The length test is a one-time filter over
-- the parameter, so a branch whose filter is false is skipped whole; an OR
-- would be evaluated per row and would put the planner back where it
-- started. Both branches order and cap identically, so which 1,200
-- candidates are chosen does not depend on which one ran.
--
-- Everything 0055 won on three-character-and-longer tokens is unchanged:
-- agua sanitaria 43ms/6,781 to 6ms/1,475, sabonete 155/20,481 to
-- 123/15,766.

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
    -- Two branches, and only ever one of them runs.
    --
    -- A trigram is three characters, so pg_trgm cannot index a pattern
    -- shorter than that: it answers `like '%ar%'` by returning every entry
    -- in the index and then visiting every heap page they point at, which
    -- is the seq scan it replaced plus the index read on top. Measured,
    -- best of three interleaved runs: "ar" 148ms/18,380 blocks before,
    -- 278ms/20,718 after; "tv" 38ms/5,727 before, 157ms/8,065 after.
    --
    -- So the indexable predicate is emitted only when the longest token can
    -- produce a trigram. The length test is a one-time filter over the
    -- parameter rather than a per-row condition, which is why this is two
    -- branches and not an OR: an OR would be evaluated per row and would
    -- put the planner back where it started, while a branch whose one-time
    -- filter is false is skipped whole.
    (
      select p.id, p.name, p.description, p.brand, p.size_amount, p.size_unit,
             p.image_url, p.gtin14, p.search_text
      from products p
      where (select max(length(tok)) from unnest(p_tokens) as tok) >= 3
        -- One token, written so the planner can reach the trigram index.
        --
        -- The two ALL(array) forms are correct and unindexable: the planner
        -- cannot push a scalar array operator into an index condition, so it
        -- read all 78,610 rows every time. This repeats the same test for
        -- the most selective token as a plain predicate against a pattern it
        -- can extract trigrams from, which turns the scan into a bitmap
        -- index scan and leaves the ALL forms as residual filters.
        --
        -- The longest token, because trigram selectivity goes with length:
        -- "sanitaria" has nine trigrams to intersect on. Ties broken by
        -- value so the choice is deterministic and the plan is stable.
        --
        -- Implied by the regex, exactly as the cheap test below is, so it
        -- cannot change which products qualify.
        and p.search_text like (
          '%' || (select tok from unnest(p_tokens) as tok
                   order by length(tok) desc, tok limit 1) || '%'
        )
        -- Cheap test next. `like '%tok%'` is implied by the regex — a match
        -- at a word start means the substring is somewhere in the text — so
        -- adding it cannot change which products qualify. It only spares the
        -- regex from being run against the rows that cannot match.
        and p.search_text like all (
          array(select '%' || tok || '%' from unnest(p_tokens) as tok)
        )
        and p.search_text ~ all (
          array(select '\m' || tok from unnest(p_tokens) as tok)
        )
      -- Shortest text first decides which candidates are considered: it
      -- favours "Arroz Camil 5kg" over a name padded with marketing. The
      -- ranking below then decides what the shopper actually sees. Both
      -- branches order and cap identically, so which 1,200 are chosen does
      -- not depend on which branch ran.
      order by length(p.search_text), p.name, p.id
      limit 1200
    )
    union all
    (
      select p.id, p.name, p.description, p.brand, p.size_amount, p.size_unit,
             p.image_url, p.gtin14, p.search_text
      from products p
      where (select max(length(tok)) from unnest(p_tokens) as tok) < 3
        and p.search_text like all (
          array(select '%' || tok || '%' from unnest(p_tokens) as tok)
        )
        and p.search_text ~ all (
          array(select '\m' || tok from unnest(p_tokens) as tok)
        )
      order by length(p.search_text), p.name, p.id
      limit 1200
    )
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
