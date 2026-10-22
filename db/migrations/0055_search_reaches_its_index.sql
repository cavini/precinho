-- The search starts using the index it has been paying for since 0001.
--
-- The symptom is a search returning nothing and the same search a second
-- later returning results. I have fixed two causes of that already — a
-- statement timeout, then queries cancelled by the partial prerender — and
-- it is still happening.
--
-- `search_text like all (array(...))` is a scalar array operator, and the
-- planner cannot push one into an index condition. So the GIN trigram index
-- on search_text, 44 MB of this database, has never once been used by a
-- search. Every query was a sequential scan of all 78,610 products.
--
-- Repeating the same test for one token as a plain predicate against a
-- pattern the planner can extract trigrams from turns the candidate scan
-- into a bitmap index scan. Measured on the whole function, warm, best of
-- two runs each, same rows out:
--
--   term              before        after        I/O
--   repelex 200ml     40ms  5,778   3ms    359   16.1x less
--   agua sanitaria    43ms  6,781   6ms  1,475    4.6x less
--   detergente        52ms  9,707  16ms  4,506    2.2x less
--   queijo           154ms 18,676 100ms 14,581    1.3x less
--   sabonete         195ms 20,522 121ms 15,766    1.3x less
--
-- The win is largest where it matters most and smallest on common single
-- words, and that is worth being clear about: a token like "sabonete"
-- matches enough rows that the bitmap heap scan still reads much of the
-- table, and what is left of the 15,000 blocks is the offers stage, not the
-- candidate stage. The candidate stage itself goes from 22,810 buffers to
-- about 3,200 on every term, selective or not. 117 MB touched per search
-- becomes 81 MB.
--
-- Why this is what fixes an intermittent empty result: the anon role, which
-- is the one the app connects as, has statement_timeout=3s. The figures
-- above are with every block already in cache. The same work against a cold
-- buffer cache is reads from network storage rather than hits, and it has
-- been getting worse every night — products grew 1,424 rows on a single
-- Carrefour run today, and offers is append-only at 438,759 rows.
--
-- I have not caught a cold query timing out in the act, so that last step is
-- an inference from the volume rather than a measurement. 0056 raises the
-- timeout for the same reason, which is the half of this I am sure about.
--
-- The longest token is the one promoted, because trigram selectivity goes
-- with length: "sanitaria" has nine trigrams to intersect on and "ml" has
-- none the index can use. Ties broken by value so the plan is stable.
--
-- Verified against the function it replaces on 30 terms at two offsets,
-- comparing full result sets: identical on all 60.
--
-- 0053 added the LIKE pre-filter to spare the regex and measured a real win,
-- but measured it warm, where a seq scan of a cached table is expensive
-- rather than fatal. The lesson is that a cheap test has to be reachable by
-- an index, not just cheap per row.
--
-- A tsvector index is still the wrong answer, for the reason 0053 gave:
-- to_tsvector('simple', ...) reads "salg.arroz" as one token, so a search
-- for arroz loses that product and four others like it.

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
    -- One token, written so the planner can reach the trigram index.
    --
    -- The two ALL(array) forms below are correct and unindexable: the
    -- planner cannot push a scalar array operator into an index condition,
    -- so it read all 78,610 rows every time. This repeats the same test for
    -- the single most selective token as a plain predicate against a
    -- pattern it can extract trigrams from, which turns the scan into a
    -- bitmap index scan and leaves the ALL forms as residual filters over
    -- what survives.
    --
    -- The longest token, because trigram selectivity goes with length:
    -- "sanitaria" has nine trigrams to intersect on and "ml" has none the
    -- index can use. Ties broken by value so the choice is deterministic
    -- and the plan is stable.
    --
    -- Implied by the regex, exactly as the cheap test below is, so it
    -- cannot change which products qualify. Verified on 20 terms at two
    -- offsets against the function it replaces: identical result sets.
    where p.search_text like (
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
